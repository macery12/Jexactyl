<?php

namespace Everest\Tests\Integration\Api\Client\Server;

use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Models\Permission;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolExecutor;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\ToolInvocation;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

/**
 * The agent's security boundary.
 *
 * The whole design rests on one claim: a tool call traverses exactly the same
 * authorization as the equivalent browser request, so there is no second path
 * to get wrong. These tests are what hold that claim honest.
 */
class AgentToolExecutorTest extends ClientApiIntegrationTestCase
{
    private ToolExecutor $executor;

    private ToolRegistry $registry;

    public function setUp(): void
    {
        parent::setUp();

        $this->executor = $this->app->make(ToolExecutor::class);
        $this->registry = new ToolRegistry(
            new RiskGate(new ConsoleCommandGate()),
            new SchemaValidator(),
            $this->app->make(AdminAuthorizer::class),
        );
    }

    /**
     * Stand in for the streaming controller: a resolved, authenticated parent
     * request, which is the state the executor runs inside.
     */
    private function actAsParentRequest($user, Server $server): void
    {
        $this->actingAs($user);

        $parent = Request::create("http://localhost/api/client/servers/{$server->uuid}/ai/agent", 'POST');
        $parent->setUserResolver(fn () => $user);

        $this->app->instance('request', $parent);
    }

    private function invoke(ToolDefinition $definition, Server $server, array $arguments = []): ToolInvocation
    {
        return $definition->invoke($arguments, $this->registry->serverContext($server, $arguments));
    }

    /*
    |--------------------------------------------------------------------------
    | Server isolation
    |--------------------------------------------------------------------------
    */

    public function testATargetedServerBelongingToAnotherUserReturns404NotData(): void
    {
        [$user] = $this->generateTestAccount();
        [, $otherServer] = $this->generateTestAccount();

        $this->actAsParentRequest($user, $otherServer);

        // Bypass the registry's own binding and aim an invocation straight at
        // a server the acting user has no relationship with.
        $result = $this->executor->execute(new ToolInvocation(
            'activity_recent',
            'GET',
            "/api/client/servers/{$otherServer->uuid}/activity",
        ));

        $this->assertFalse($result->ok);
        // 404 rather than 403: the panel deliberately does not confirm that a
        // server it will not show you exists at all.
        $this->assertSame(404, $result->status);
        $this->assertFalse($result->retryable);
    }

    public function testServerScopedToolSchemasDoNotAcceptAServerArgument(): void
    {
        // The structural property the isolation rests on: a hallucinated or
        // injected server id has nowhere to land, because no server-scoped
        // tool takes one.
        foreach ($this->registry->all() as $definition) {
            if ($definition->scope !== ToolDefinition::SCOPE_SERVER) {
                continue;
            }

            $properties = $definition->parameters['properties'] ?? [];
            $properties = is_array($properties) ? $properties : [];

            $this->assertArrayNotHasKey(
                'server',
                $properties,
                sprintf('Tool "%s" must not accept a server argument.', $definition->name)
            );

            if ($definition->hostHandled) {
                $this->assertSame(
                    '',
                    $definition->uriTemplate,
                    sprintf('Host-handled tool "%s" must not dispatch an API route.', $definition->name)
                );

                continue;
            }

            $this->assertStringContainsString(
                '{server}',
                $definition->uriTemplate,
                sprintf('Tool "%s" must bind its server from turn context.', $definition->name)
            );
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Permissions
    |--------------------------------------------------------------------------
    */

    public function testASubuserWithoutThePermissionGetsAForbiddenToolError(): void
    {
        // A subuser with an unrelated permission — no activity.read.
        [$user, $server] = $this->generateTestAccount([Permission::ACTION_FILE_READ]);

        $this->actAsParentRequest($user, $server);

        $definition = $this->registry->find('activity_recent');
        $result = $this->executor->execute($this->invoke($definition, $server));

        $this->assertFalse($result->ok);
        $this->assertSame(403, $result->status);
        // Not retryable: no amount of rephrasing gives the user the permission.
        $this->assertFalse($result->retryable);
    }

    public function testTheRegistryDoesNotOfferToolsTheUserCannotUse(): void
    {
        [$user, $server] = $this->generateTestAccount([Permission::ACTION_FILE_READ]);

        $offered = array_map(
            fn (ToolDefinition $d) => $d->name,
            $this->registry->forServer($user, $server)
        );

        $this->assertContains('files_list', $offered);
        $this->assertNotContains('activity_recent', $offered);
        // No file.update, so the write tool is never even described.
        $this->assertNotContains('files_write', $offered);
    }

    /**
     * An owner's catalogue is everything they may do, with nothing withheld.
     *
     * This used to assert the opposite for grouped tools — `backup_create` was
     * hidden until the model asked for the "backups" group. Groups are gone: the
     * registry now answers "what may this user do", and `WorkingSetPlanner`
     * separately decides how much of that is worth a schema slot this step. The
     * two questions were conflated while every permitted tool was offered at
     * once, and keeping them conflated is what made a tool the user held a
     * permission for look, from the model's side, like a capability the panel
     * lacked.
     */
    public function testAServerOwnersCatalogueHoldsEverythingTheyMayDo(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $offered = array_map(
            fn (ToolDefinition $d) => $d->name,
            $this->registry->forServer($user, $server)
        );

        $this->assertContains('files_read', $offered);
        $this->assertContains('files_write', $offered);
        $this->assertContains('server_power', $offered);
        $this->assertContains('backup_create', $offered);
        $this->assertContains('files_delete', $offered);

        // Still bounded by scope: the admin surface is not reachable from here,
        // whatever the acting user happens to be on the panel.
        $this->assertNotContains('admin_overview', $offered);
    }

    /*
    |--------------------------------------------------------------------------
    | Container state
    |--------------------------------------------------------------------------
    */

    public function testTheParentRequestIsRestoredAfterDispatch(): void
    {
        [$user, $server] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $server);

        $before = $this->app->make('request');
        $this->executor->execute($this->invoke($this->registry->find('activity_recent'), $server));
        $after = $this->app->make('request');

        // The streaming controller keeps using this request after every tool
        // call; leaving the sub-request bound would corrupt the rest of the turn.
        $this->assertSame($before, $after);
        $this->assertSame($user->id, $after->user()?->id);
    }

    public function testFractalIncludesDoNotLeakBetweenToolCalls(): void
    {
        [$user, $server] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $server);

        // Routes are shared across the process and Route::getController()
        // memoises onto them, while the API controllers accumulate Fractal
        // includes. Without clearing the cached controller, the first call's
        // includes would reappear in the second.
        $first = $this->executor->execute(new ToolInvocation(
            'server_view',
            'GET',
            "/api/client/servers/{$server->uuid}",
            ['include' => 'egg'],
        ));
        $this->assertTrue($first->ok);

        $second = $this->executor->execute(new ToolInvocation(
            'server_view',
            'GET',
            "/api/client/servers/{$server->uuid}",
        ));
        $this->assertTrue($second->ok);

        $this->assertArrayNotHasKey(
            'egg',
            $second->data['attributes']['relationships'] ?? [],
            'A previous tool call\'s ?include= leaked into a later one.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Error shaping
    |--------------------------------------------------------------------------
    */

    public function testValidationFailuresComeBackAsRetryablePerFieldErrors(): void
    {
        [$user, $server] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $server);

        $definition = $this->registry->find('server_power');
        $result = $this->executor->execute($this->invoke($definition, $server, ['signal' => 'explode']));

        $this->assertFalse($result->ok);
        $this->assertSame(422, $result->status);
        // The model can fix its own arguments from this, so the turn continues.
        $this->assertTrue($result->retryable);
        $this->assertIsArray($result->fields);
        $this->assertArrayHasKey('signal', $result->fields);
    }

    public function testInternalDetailNeverReachesTheModelEvenWithDebugOn(): void
    {
        config()->set('app.debug', true);

        [$user] = $this->generateTestAccount();
        [, $otherServer] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $otherServer);

        $result = $this->executor->execute(new ToolInvocation(
            'activity_recent',
            'GET',
            "/api/client/servers/{$otherServer->uuid}/activity",
        ));

        $payload = $result->toModelPayload();

        // With APP_DEBUG on, the exception handler attaches file paths, line
        // numbers and a full stack trace. All of that would be replayed into
        // the model context and out to the user's screen over SSE.
        $this->assertStringNotContainsString('/var/www', $payload);
        $this->assertStringNotContainsString('trace', $payload);
        $this->assertStringNotContainsString('.php', $payload);
    }

    public function testAStreamingEndpointIsRefusedRatherThanSent(): void
    {
        [$user, $server] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $server);

        // Reading a StreamedResponse's body means sending it, which would
        // write straight into the caller's live SSE stream.
        $result = $this->executor->execute(new ToolInvocation(
            'recursion',
            'POST',
            "/api/client/servers/{$server->uuid}/ai/agent",
        ));

        $this->assertFalse($result->ok);
    }

    public function testToolCallsAreRefusedInsideATransaction(): void
    {
        [$user, $server] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $server);

        $this->app->make('db')->beginTransaction();

        try {
            $result = $this->executor->execute($this->invoke($this->registry->find('activity_recent'), $server));

            // The exception handler rolls back to level 0 when it renders, so a
            // failure inside the sub-request would discard the caller's work.
            $this->assertFalse($result->ok);
            $this->assertSame('internal_error', $result->code);
        } finally {
            $this->app->make('db')->rollBack();
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Success path
    |--------------------------------------------------------------------------
    */

    public function testASuccessfulReadIsShapedForTheModel(): void
    {
        [$user, $server] = $this->generateTestAccount();
        $this->actAsParentRequest($user, $server);

        $definition = $this->registry->find('startup_list');
        $result = $definition->shape($this->executor->execute($this->invoke($definition, $server)));

        $this->assertTrue($result->ok);
        // Shaped, not raw: an unshaped panel response is sized for a UI, not a
        // context window.
        $this->assertArrayHasKey('variables', $result->data);
        $this->assertArrayHasKey('startup_command', $result->data);
    }

    public function testAgentTrafficIsIdentifiableForRateLimiting(): void
    {
        $plain = Request::create('/api/client/servers/x/activity', 'GET');
        $this->assertFalse(ToolExecutor::isInternal($plain));

        // Unforgeable: the marker is an object identity in the server-side
        // attribute bag, which nothing on the wire can populate.
        $spoofed = Request::create('/api/client/servers/x/activity', 'GET', [
            'everest.ai.internal_tool_call' => true,
        ]);
        $spoofed->headers->set('everest.ai.internal_tool_call', '1');
        $this->assertFalse(ToolExecutor::isInternal($spoofed));
    }
}
