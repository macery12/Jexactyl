<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Everest\Models\Permission;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Agent\AssistBinding;
use Everest\Services\AI\Agent\AssistSession;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\SystemPromptBuilder;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * An administrator's audited session inside a customer's server.
 *
 * This is the one place in the panel where somebody who is neither the server's
 * owner nor a panel Owner gets through `AuthenticateServerAccess` and
 * `ServerPolicy`, so the tests here are mostly about how narrow that gap is:
 * that it is shut unless a session is open, that it only ever admits the
 * abilities the session was granted, and that none of it can be widened by
 * editing the JSON a suspended turn was stored in.
 */
class AssistSessionTest extends TestCase
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

    private function server(): Server
    {
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';

        return $server;
    }

    private function binding(bool $writable = false): AssistBinding
    {
        $base = new AssistBinding(
            serverUuid: $this->server()->uuid,
            serverName: 'Survival SMP',
            reason: 'Ticket #2 — server will not start',
            ticketId: 2,
        );

        return $writable ? $base->escalated() : $base;
    }

    /*
    |--------------------------------------------------------------------------
    | The ambient window
    |--------------------------------------------------------------------------
    */

    public function testTheSessionIsShutOutsideTheCallItWraps(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);

        // Nothing outside `during()` can open one, and this is the state every
        // browser request sees.
        $this->assertFalse($session->covers($admin, $this->server()));
        $this->assertFalse($session->permits($admin, $this->server(), Permission::ACTION_FILE_READ));
    }

    public function testTheSessionIsOpenOnlyForTheDurationOfTheCall(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);
        $server = $this->server();

        $inside = $session->during($admin, $this->binding(), fn () => $session->covers($admin, $server));

        $this->assertTrue($inside);
        $this->assertFalse($session->covers($admin, $server));
    }

    public function testTheSessionClosesEvenWhenTheCallThrows(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);

        try {
            $session->during($admin, $this->binding(), function () {
                throw new \RuntimeException('the node was unreachable');
            });
        } catch (\RuntimeException) {
            // A tool call that blows up must not leave an administrator standing
            // inside a customer's server for the rest of the request.
        }

        $this->assertFalse($session->covers($admin, $this->server()));
    }

    public function testASessionDoesNotCoverAnotherServer(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);

        $other = new Server();
        $other->uuid = '11111111-2222-3333-4444-555555555555';

        $seen = $session->during($admin, $this->binding(), fn () => $session->covers($admin, $other));

        $this->assertFalse($seen);
    }

    public function testASessionDoesNotCoverAnotherAdministrator(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);
        $colleague = User::factory()->make(['id' => 8]);

        $seen = $session->during($admin, $this->binding(), fn () => $session->covers($colleague, $this->server()));

        $this->assertFalse($seen);
    }

    public function testARestrictedSessionRefusesAbilitiesItWasNotGranted(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);
        $server = $this->server();

        [$read, $write, $delete] = $session->during($admin, $this->binding(), fn () => [
            $session->permits($admin, $server, Permission::ACTION_FILE_READ),
            $session->permits($admin, $server, Permission::ACTION_FILE_UPDATE),
            $session->permits($admin, $server, Permission::ACTION_FILE_DELETE),
        ]);

        $this->assertTrue($read);
        // Read-only until an administrator approves the widening separately.
        $this->assertFalse($write);
        // Never, at any tier: fixing a server does not require destroying part
        // of it, and the customer owns the files.
        $this->assertFalse($delete);
    }

    public function testEscalationGrantsWritesButStillNotDeletion(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);
        $server = $this->server();

        [$write, $restart, $delete] = $session->during($admin, $this->binding(writable: true), fn () => [
            $session->permits($admin, $server, Permission::ACTION_FILE_UPDATE),
            $session->permits($admin, $server, Permission::ACTION_CONTROL_RESTART),
            $session->permits($admin, $server, Permission::ACTION_FILE_DELETE),
        ]);

        $this->assertTrue($write);
        $this->assertTrue($restart);
        $this->assertFalse($delete);
    }

    public function testSessionsCannotNest(): void
    {
        $session = new AssistSession();
        $admin = User::factory()->make(['id' => 7]);

        $this->expectException(\LogicException::class);

        $session->during($admin, $this->binding(), function () use ($session, $admin) {
            // A nested open would restore the *wider* binding on its way out.
            $session->during($admin, $this->binding(writable: true), fn () => null);
        });
    }

    /*
    |--------------------------------------------------------------------------
    | What a session may reach
    |--------------------------------------------------------------------------
    */

    public function testAssistOffersDiagnosticToolsAndNoWrites(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $binding = $this->binding();

        $names = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forAssist($binding->tools(), $binding->abilities)
        );

        $this->assertContains('files_read', $names);
        $this->assertContains('server_status', $names);
        $this->assertContains('startup_list', $names);

        $this->assertNotContains('files_write', $names);
        $this->assertNotContains('files_delete', $names);
        $this->assertNotContains('server_power', $names);
        $this->assertNotContains('backup_delete', $names);
    }

    public function testEscalatedAssistOffersWritesButNeverDeletes(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $binding = $this->binding(writable: true);

        $names = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forAssist($binding->tools(), $binding->abilities)
        );

        $this->assertContains('files_write', $names);
        $this->assertContains('server_power', $names);
        $this->assertNotContains('files_delete', $names);
        $this->assertNotContains('backup_delete', $names);
    }

    /**
     * The whole offered set for a session, as the loop composes it.
     *
     * @return string[]
     */
    private function offerings(ToolRegistry $registry, AssistBinding $binding): array
    {
        $context = new AgentContext(User::factory()->make(['id' => 3]), null, 'turn-1');
        $context->bindAssist($binding, $this->server());
        // Every group active, which is the case that matters: the companion
        // tools all sit in `support`, so measuring with no groups active would
        // measure a set that has already shed the tools most likely to be cut.
        $context->activeGroups = array_keys(AdminTools::GROUP_DESCRIPTIONS);

        // `assistOfferings()` reads nothing but the registry, so the runner's
        // other constructor dependencies are not worth standing up to ask it
        // what a session is offered.
        $runner = (new \ReflectionClass(AgentRunner::class))->newInstanceWithoutConstructor();
        (new \ReflectionProperty(AgentRunner::class, 'registry'))->setValue($runner, $registry);

        return array_map(
            fn (ToolDefinition $d) => $d->name,
            (new \ReflectionMethod(AgentRunner::class, 'assistOfferings'))->invoke($runner, $context)
        );
    }

    /**
     * `capTools()` truncates the tail, and the tail here is the companion admin
     * tools — so an offering over the cap quietly removes the ability to re-read
     * the ticket at the exact point the session starts changing things. It now
     * says so in the log, but a session that only works because someone reads
     * the log is still a session that does not work.
     */
    public function testASessionFitsInsideTheToolCap(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $cap = (int) config('modules.ai.agent.max_tools');

        foreach ([false, true] as $writable) {
            // `ask_user` rides along in the offering but is exempt from the cap,
            // as is the `activate_tool_group` the loop appends — so neither is
            // counted here. See AgentRunner::UNCAPPED_TOOLS.
            $offered = array_values(array_diff(
                $this->offerings($registry, $this->binding(writable: $writable)),
                [SharedTools::ASK_USER]
            ));

            $this->assertLessThanOrEqual(
                $cap,
                count($offered),
                sprintf(
                    '%s assist offers %d scoped tools against a cap of %d; %s would be dropped.',
                    $writable ? 'A writable' : 'A read-only',
                    count($offered),
                    $cap,
                    implode(', ', array_slice($offered, $cap)) ?: 'nothing'
                )
            );
        }
    }

    /**
     * The escalation card is a decision about somebody else's server, and the
     * only party who can settle an ambiguous one is the administrator reading it.
     */
    public function testASessionCanStillAskAQuestion(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $this->assertContains('ask_user', $this->offerings($registry, $this->binding()));
        $this->assertContains('ask_user', $this->offerings($registry, $this->binding(writable: true)));
    }

    /**
     * There is no wider grant left to ask for, and no reason to open a session
     * on a second server while holding writes on the first.
     */
    public function testEscalatingDropsTheToolsThatHaveRunOutOfMeaning(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $read = $this->offerings($registry, $this->binding());
        $this->assertContains(AdminTools::ASSIST_ALLOW_WRITES, $read);
        $this->assertContains(AdminTools::ASSIST_SERVER, $read);

        $written = $this->offerings($registry, $this->binding(writable: true));
        $this->assertNotContains(AdminTools::ASSIST_ALLOW_WRITES, $written);
        $this->assertNotContains(AdminTools::ASSIST_SERVER, $written);
        $this->assertContains('admin_ticket_messages', $written);
    }

    /**
     * The commonest cause of "it used to start and now it doesn't" is a runtime
     * that no longer matches the jar, and the panel keeps that behind its own
     * permission rather than in a startup variable — so a session that could
     * only edit variables could diagnose the fault and not fix it.
     */
    public function testEscalationReachesTheDockerImage(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        $this->assertNotContains('startup_image_set', $this->offerings($registry, $this->binding()));
        $this->assertContains('startup_image_set', $this->offerings($registry, $this->binding(writable: true)));

        $this->assertFalse($this->binding()->permits(Permission::ACTION_STARTUP_DOCKER_IMAGE));
        $this->assertTrue($this->binding(writable: true)->permits(Permission::ACTION_STARTUP_DOCKER_IMAGE));
    }

    public function testAToolIsRefusedWhenItsAbilityIsNotInTheGrant(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $definition = $registry->find('files_write');

        // The two lists are checked independently: the names decide what is
        // advertised, the abilities decide what will run. Naming a tool without
        // granting its ability must not open it.
        $this->assertFalse(
            $registry->assistPermits($definition, ['files_write'], AssistBinding::READ_ABILITIES)
        );
    }

    public function testNoAssistToolIsRegisteredWithoutTheCapability(): void
    {
        $registry = $this->registry($this->authorizer([AdminRole::TICKETS_READ]));

        $names = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forAdmin(User::factory()->make(), ['support'])
        );

        // An administrator who can read tickets but has not been given
        // `servers.assist` is never shown the door, let alone offered it.
        $this->assertContains('admin_ticket_view', $names);
        $this->assertNotContains(AdminTools::ASSIST_SERVER, $names);
    }

    public function testTheAssistToolIsOfferedToAHolderOfTheCapability(): void
    {
        $registry = $this->registry($this->authorizer([AdminRole::TICKETS_READ, AdminRole::SERVERS_ASSIST]));

        $names = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forAdmin(User::factory()->make(), ['support'])
        );

        $this->assertContains(AdminTools::ASSIST_SERVER, $names);
    }

    public function testOpeningASessionNeedsApprovalRatherThanRunningOnSight(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $definition = $registry->find(AdminTools::ASSIST_SERVER);

        // It reads nothing itself, but what it does is grant access to somebody
        // else's data — a decision a person makes, not a step the model takes.
        $this->assertSame(ToolDefinition::RISK_WRITE, $definition->risk);
        $this->assertTrue($definition->hostHandled);
        $this->assertFalse($definition->isAutomatic($definition->risk));
    }

    public function testTheCapabilityIsRegisteredAndNotAnOrphan(): void
    {
        // A constant with no entry in the permissions catalogue fails every
        // `isValid()` check and can never be granted through the UI, so it would
        // silently mean "nobody, ever".
        $this->assertContains(
            AdminRole::SERVERS_ASSIST,
            app(\Everest\Services\Authorization\AdminCapabilityRegistry::class)->all()
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Surviving the round trip
    |--------------------------------------------------------------------------
    */

    public function testABindingSurvivesSuspensionButComesBackInert(): void
    {
        $user = User::factory()->make(['id' => 7]);

        $context = new AgentContext($user, null, 'turn-1');
        $context->bindAssist($this->binding(), $this->server());

        $restored = AgentContext::fromState($user, null, 'turn-1', null, $context->toState());

        $this->assertNotNull($restored->assist);
        $this->assertSame($this->server()->uuid, $restored->assist->serverUuid);
        // Restored without its server, so nothing can be dispatched against it
        // until the caller has re-read the row and re-checked the capability.
        $this->assertNull($restored->targetServer());
        $this->assertSame($this->server()->uuid, $restored->pendingAssistUuid());
    }

    public function testStoredAbilitiesOutsideTheDeclaredListsAreDiscarded(): void
    {
        $tampered = AssistBinding::fromArray([
            'server_uuid' => $this->server()->uuid,
            'server_name' => 'Survival SMP',
            'reason' => 'x',
            'abilities' => [Permission::ACTION_FILE_READ, Permission::ACTION_FILE_DELETE, 'settings.reinstall'],
            'writable' => true,
        ]);

        // The stored blob is the one part of a suspended turn that a bug
        // elsewhere could widen, so it is re-intersected rather than trusted.
        $this->assertTrue($tampered->permits(Permission::ACTION_FILE_READ));
        $this->assertFalse($tampered->permits(Permission::ACTION_FILE_DELETE));
        $this->assertFalse($tampered->permits('settings.reinstall'));
    }

    public function testABindingWithoutAServerUuidIsRejectedOutright(): void
    {
        $this->assertNull(AssistBinding::fromArray(['reason' => 'x', 'abilities' => ['file.read']]));
        $this->assertNull(AssistBinding::fromArray('not an array'));
    }

    public function testAnAssistTurnStaysOnTheAdminScope(): void
    {
        $user = User::factory()->make(['id' => 7]);

        $context = new AgentContext($user, null, 'turn-1');
        $context->bindAssist($this->binding(), $this->server());

        // Reading the binding as a scope change would hand the administrator the
        // customer's whole toolset and write their audit rows as if a customer
        // had made them.
        $this->assertSame(ToolDefinition::SCOPE_ADMIN, $context->scope());
        $this->assertSame($this->server()->uuid, $context->targetServer()->uuid);
    }

    public function testUriContextFollowsTheToolRatherThanThePresenceOfAServer(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $server = $this->server();

        $adminTool = $registry->find('admin_ticket_view');
        $serverTool = $registry->find('files_read');

        // Both run in the same turn once a session is open, and only one of them
        // wants the server interpolated. Branching on "is there a server?" would
        // feed a uuid into the admin URI builder and mangle the ticket id.
        $this->assertSame(
            ['ticket' => '2'],
            $registry->contextForTool($adminTool, $server, ['ticket' => 2])
        );
        $this->assertSame(
            ['server' => $server->uuid],
            $registry->contextForTool($serverTool, $server, ['path' => '/server.properties'])
        );
    }

    /*
    |--------------------------------------------------------------------------
    | What the model is told
    |--------------------------------------------------------------------------
    */

    public function testThePromptNamesTheServerAndItsAccessLevel(): void
    {
        $user = User::factory()->make(['id' => 7, 'username' => 'support-jo']);

        $context = new AgentContext($user, null, 'turn-1');
        $context->bindAssist($this->binding(), $this->server());

        $prompt = app(SystemPromptBuilder::class)->build($context);

        $this->assertStringContainsString('Survival SMP', $prompt);
        $this->assertStringContainsString('read only', $prompt);
        $this->assertStringContainsString('Ticket: #2', $prompt);
        $this->assertStringContainsString('admin_assist_allow_writes', $prompt);
    }

    public function testThePromptSaysNothingAboutServersWhenNoSessionIsOpen(): void
    {
        $user = User::factory()->make(['id' => 7, 'username' => 'support-jo']);

        $prompt = app(SystemPromptBuilder::class)->build(new AgentContext($user, null, 'turn-1'));

        $this->assertStringNotContainsString('Survival SMP', $prompt);
        $this->assertStringNotContainsString('read and write', $prompt);
        // It is still told how to get there, so it does not simply give up on a
        // ticket about a server.
        $this->assertStringContainsString('admin_assist_server', $prompt);
    }
}
