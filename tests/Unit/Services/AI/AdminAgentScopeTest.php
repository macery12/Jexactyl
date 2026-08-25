<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\SystemPromptBuilder;
use Everest\Services\Authorization\AdminAuthorizer;

/**
 * What separates an admin turn from a server turn.
 *
 * The two share a loop, a provider and an executor; the only thing keeping an
 * administrator's assistant out of a customer's server — and a customer's
 * assistant out of the panel's own records — is which toolset a turn is offered
 * and which authorization model filters it.
 */
class AdminAgentScopeTest extends TestCase
{
    private function registry(AdminAuthorizer $authorizer): ToolRegistry
    {
        return new ToolRegistry(new RiskGate(new ConsoleCommandGate()), new SchemaValidator(), $authorizer);
    }

    /**
     * @param string[] $held
     */
    private function authorizer(array $held, bool $owner = false): AdminAuthorizer
    {
        $mock = \Mockery::mock(AdminAuthorizer::class);
        $mock->shouldReceive('hasCapability')
            ->andReturnUsing(fn (User $user, string $capability) => $owner || in_array($capability, $held, true));
        $mock->shouldReceive('isOwner')->andReturn($owner);

        return $mock;
    }

    public function testAServerTurnIsNeverOfferedAnAdminTool(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $offered = $registry->forServer(new User(), new Server(), ['billing', 'commerce', 'support', 'panel']);

        foreach ($offered as $definition) {
            $this->assertNotSame(ToolDefinition::SCOPE_ADMIN, $definition->scope, $definition->name);
        }
    }

    public function testAnAdminTurnIsNeverOfferedAServerTool(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $offered = $registry->forAdmin(new User(), ['billing', 'commerce', 'support', 'panel', 'backups', 'mods']);

        foreach ($offered as $definition) {
            $this->assertNotSame(ToolDefinition::SCOPE_SERVER, $definition->scope, $definition->name);
        }
    }

    /**
     * The tool list is filtered by the acting administrator's own capabilities.
     * A delegated admin who may look at the catalogue must not be offered the
     * tool that edits it — they would only be refused when it ran, having spent
     * a step and told the user a change was coming.
     */
    public function testADelegatedAdminIsOfferedOnlyWhatTheyHold(): void
    {
        $registry = $this->registry($this->authorizer([AdminRole::BILLING_READ]));

        $names = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forAdmin(new User(), ['billing'])
        );

        $this->assertContains('admin_products_list', $names);
        $this->assertNotContains('admin_product_create', $names);
        $this->assertNotContains('admin_product_update', $names);
    }

    /**
     * `AdminAuthorizer::capabilities()` returns the literal `['*']` for an
     * owner, which matches no real capability string. Reading that array rather
     * than asking `hasCapability()` would leave the owner with no tools at all.
     */
    public function testAnOwnerIsOfferedEverything(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $names = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forAdmin(new User(), ['billing', 'commerce'])
        );

        $this->assertContains('admin_product_create', $names);
        $this->assertContains('admin_coupon_create', $names);
    }

    public function testCouponCreationRequiresAnExplicitPurchaseScope(): void
    {
        $definition = $this->registry($this->authorizer([], owner: true))->find('admin_coupon_create');

        $this->assertContains('allowed_for', $definition->parameters['required']);
    }

    public function testAssistGatewaysCarryTheIncidentRecoveryBoundariesAtDecisionTime(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $open = $registry->find('admin_assist_server');
        $escalate = $registry->find('admin_assist_allow_writes');

        $this->assertStringContainsString('owner has several', $open->description);
        $this->assertStringContainsString('never choose from its name, egg, or software', $open->description);
        $this->assertStringContainsString('missing jar', $escalate->description);
        $this->assertStringContainsString('server reinstall and stop', $escalate->description);
    }

    /**
     * Host-handled tools belong to neither surface and must appear on both.
     */
    public function testTheSharedToolIsOfferedOnBothSurfaces(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $server = array_map(fn (ToolDefinition $d) => $d->name, $registry->forServer(new User(), new Server()));
        $admin = array_map(fn (ToolDefinition $d) => $d->name, $registry->forAdmin(new User()));

        $this->assertContains('ask_user', $server);
        $this->assertContains('ask_user', $admin);
    }

    /**
     * The URI context is what a hallucinated identifier would have to land in.
     * On the server surface the uuid comes from the route, so a model-supplied
     * `server` argument must be ignored entirely.
     */
    public function testAModelCannotOverrideTheBoundServer(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $server = new Server();
        $server->uuid = 'bound-uuid';

        $context = $registry->serverContext($server, ['server' => 'somebody-elses-uuid']);

        $this->assertSame('bound-uuid', $context['server']);
    }

    /**
     * The admin surface has no bound subject, so identifiers do come from the
     * model — this is the one place that is true, and it is worth pinning so a
     * later change cannot silently widen it to the server surface.
     */
    public function testAdminIdentifiersComeFromArguments(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $context = $registry->adminContext(['category' => '3', 'product' => '17', 'nonsense' => 'x']);

        $this->assertSame(['category' => '3', 'product' => '17'], $context);
    }

    /**
     * An admin turn has no server, and the prompt must not pretend otherwise —
     * telling it to read /plugins or call files_write only invites it to try.
     */
    public function testTheAdminPromptCarriesNoServerInstructions(): void
    {
        $user = new User();
        $user->username = 'operator';
        // Pre-set so AdminAuthorizer reads the relation instead of querying for
        // a user that was never persisted.
        $user->setRelation('adminRole', null);

        $prompt = app(SystemPromptBuilder::class)->build(new AgentContext($user, null, 'turn-uuid'));

        $this->assertStringNotContainsString('files_write', $prompt);
        $this->assertStringNotContainsString('/plugins', $prompt);
        // It can now get inside a customer's server, but only by asking for a
        // session that an administrator approves — never by default.
        $this->assertStringContainsString('cannot inspect a customer\'s server by default', $prompt);
    }

    public function testScopeIsDerivedFromTheBoundServer(): void
    {
        $this->assertSame(
            ToolDefinition::SCOPE_ADMIN,
            (new AgentContext(new User(), null, 'turn-uuid'))->scope()
        );

        $this->assertSame(
            ToolDefinition::SCOPE_SERVER,
            (new AgentContext(new User(), new Server(), 'turn-uuid'))->scope()
        );
    }
}
