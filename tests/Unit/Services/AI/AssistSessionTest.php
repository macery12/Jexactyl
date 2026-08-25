<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Everest\Models\Permission;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Agent\WorkingSet;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AssistGrant;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Agent\AssistBinding;
use Everest\Services\AI\Agent\AssistSession;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\AssistAuthorizer;
use Everest\Services\AI\Agent\WorkingSetPlanner;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\SystemPromptBuilder;
use Everest\Services\AI\Agent\PrerequisiteResolver;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\AdminTools;

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
        $server->id = 14;
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';
        $server->owner_id = 27;

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

        // Everything the session may run, rather than the subset one step
        // happens to offer. The two were the same thing when a session's tools
        // were composed by `assistOfferings()` and then capped; now the phase
        // decides what is worth a schema slot, and these tests are about the
        // *grant* — what a binding permits at all — which is what `callable()`
        // answers.
        $planner = new WorkingSetPlanner($registry, new PrerequisiteResolver());

        return array_keys($planner->callable($context));
    }

    /**
     * A session's reserved tools fit the smallest model we support.
     *
     * The predecessor of this test asserted that the *whole* session offering fit
     * under `max_tools`, because the cap truncated a tail and the tail was the
     * companion admin tools — so an over-cap session silently lost the ability to
     * re-read the ticket at the exact point it started changing things.
     *
     * Nothing truncates now, so that failure is gone and the invariant that
     * replaces it is narrower and stricter: whatever a phase *reserves* has to
     * fit the smallest profile outright, because reserved tools are spent before
     * anything is searched. A reserved set that overran would leave a small model
     * with no room at all for the tool it went looking for.
     */
    public function testAnAssistPhaseReservesLessThanTheSmallestBudget(): void
    {
        $smallest = min(array_column(ToolBudget::profiles(), 'schemas'));

        foreach ([WorkingSet::PHASE_READ_ASSIST, WorkingSet::PHASE_WRITE_ASSIST] as $phase) {
            $reserved = WorkingSet::RESERVED[$phase];

            $this->assertLessThan(
                $smallest,
                count($reserved),
                sprintf(
                    'The %s phase reserves %d tools against a smallest budget of %d, leaving nothing '
                        . 'for what the session actually goes looking for: %s.',
                    $phase,
                    count($reserved),
                    $smallest,
                    implode(', ', $reserved),
                )
            );
        }
    }

    /**
     * Everything a phase reserves has to be something the session may run.
     *
     * A reserved name that is not in the grant is invisible — the planner drops
     * it silently, because reserving decides priority and never authority — so
     * the failure is a phase that looks like it opens with five reads and opens
     * with three.
     */
    public function testEveryReservedAssistToolIsInsideTheGrant(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));

        foreach ([false, true] as $writable) {
            $callable = $this->offerings($registry, $this->binding(writable: $writable));
            $phase = $writable ? WorkingSet::PHASE_WRITE_ASSIST : WorkingSet::PHASE_READ_ASSIST;

            foreach (WorkingSet::RESERVED[$phase] as $name) {
                $this->assertContains(
                    $name,
                    $callable,
                    sprintf('%s reserves %s, which the binding does not permit.', $phase, $name),
                );
            }
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

    public function testInjectedCompanionReadsCannotEscapeTheActiveSubject(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $context = new AgentContext(User::factory()->make(['id' => 3]), null, 'turn-1');
        $context->bindAssist($this->binding(), $this->server());

        $runner = (new \ReflectionClass(AgentRunner::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod(AgentRunner::class, 'assistSubjectAllows');
        $method->setAccessible(true);

        $allows = fn (string $tool, array $arguments): bool => $method->invoke(
            $runner,
            $context,
            $registry->find($tool),
            $arguments,
        );

        // These represent identifiers copied from hostile ticket, file, and
        // console text respectively. None is part of the active subject.
        $this->assertFalse($allows('admin_user_view', ['user' => '999']));
        $this->assertFalse($allows('admin_server_view', ['server' => '999']));
        $this->assertFalse($allows('admin_ticket_messages', ['ticket' => '999']));

        $this->assertTrue($allows('admin_user_view', ['user' => '27']));
        $this->assertTrue($allows('admin_server_view', ['server' => '14']));
        $this->assertTrue($allows('admin_ticket_view', ['ticket' => '2']));

        $riskGate = new RiskGate(new ConsoleCommandGate());
        (new \ReflectionProperty(AgentRunner::class, 'riskGate'))->setValue($runner, $riskGate);
        $riskForContext = new \ReflectionMethod(AgentRunner::class, 'riskForContext');
        $riskForContext->setAccessible(true);

        $this->assertSame(
            ToolDefinition::RISK_WRITE,
            $riskForContext->invoke($runner, $context, $registry->find('admin_user_view'), ['user' => '999']),
            'A cross-subject read must stop for a visible, separate approval.',
        );
        $this->assertSame(
            ToolDefinition::RISK_SAFE,
            $riskForContext->invoke($runner, $context, $registry->find('admin_user_view'), ['user' => '27']),
            'The active server owner remains an automatic companion read.',
        );
    }

    public function testAssistWithoutATicketDoesNotOfferPanelWideTicketReaders(): void
    {
        $registry = $this->registry($this->authorizer([], owner: true));
        $binding = new AssistBinding(
            serverUuid: $this->server()->uuid,
            serverName: 'Survival SMP',
            reason: 'Server will not start',
        );

        $offered = $this->offerings($registry, $binding);

        $this->assertNotContains('admin_ticket_view', $offered);
        $this->assertNotContains('admin_ticket_messages', $offered);
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

    public function testAssistBoundaryOverridesCannotLowerEitherGrantToSafe(): void
    {
        Setting::set('settings::modules:ai:risk_overrides', json_encode([
            AdminTools::ASSIST_SERVER => ToolDefinition::RISK_SAFE,
            AdminTools::ASSIST_ALLOW_WRITES => ToolDefinition::RISK_SAFE,
        ]));

        $gate = app(RiskGate::class);
        $registry = $this->registry($this->authorizer([], owner: true));

        foreach ([AdminTools::ASSIST_SERVER, AdminTools::ASSIST_ALLOW_WRITES] as $name) {
            $this->assertSame(ToolDefinition::RISK_WRITE, $gate->resolve($registry->find($name)));
        }

        Setting::forget('settings::modules:ai:risk_overrides');
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

        // A grant is authority, not preferences. A non-canonical ability set is
        // rejected whole rather than repaired into something the user did not
        // approve.
        $this->assertNull($tampered);
    }

    public function testAuthenticatedPendingGrantRejectsEveryStateWideningAndRetarget(): void
    {
        $before = $this->binding();
        $sealed = AssistGrant::seal(
            AssistGrant::PHASE_ACTIVE,
            $before,
            $before,
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            7,
            'files_read',
            ['file' => '/server.properties'],
        );
        $grant = AssistGrant::verify(
            $sealed['grant'],
            $sealed['mac'],
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            7,
            'files_read',
            ['file' => '/server.properties'],
        );

        $this->assertNotNull($grant);
        $this->assertTrue($grant->matchesState($before->toArray()));

        $server = $before->toArray();
        $server['server_uuid'] = '11111111-2222-3333-4444-555555555555';

        $writable = $before->toArray();
        $writable['writable'] = true;
        $writable['abilities'] = array_values(array_unique(array_merge(
            AssistBinding::READ_ABILITIES,
            AssistBinding::WRITE_ABILITIES,
        )));

        $abilities = $before->toArray();
        $abilities['abilities'][] = Permission::ACTION_FILE_UPDATE;

        $tools = $before->toArray();
        $tools['tools'] = array_merge(AssistBinding::READ_TOOLS, AssistBinding::WRITE_TOOLS);

        foreach ([$server, $writable, $abilities, $tools] as $state) {
            $this->assertFalse($grant->matchesState($state));
        }
    }

    public function testAuthenticatedPendingGrantIsBoundToActorToolArgumentsAndPayload(): void
    {
        $binding = $this->binding();
        $turn = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        $arguments = ['file' => '/server.properties'];
        $sealed = AssistGrant::seal(AssistGrant::PHASE_ACTIVE, $binding, $binding, $turn, 7, 'files_read', $arguments);

        $this->assertNull(AssistGrant::verify($sealed['grant'], $sealed['mac'], $turn, 8, 'files_read', $arguments));
        $this->assertNull(AssistGrant::verify($sealed['grant'], $sealed['mac'], $turn, 7, 'files_write', $arguments));
        $this->assertNull(AssistGrant::verify($sealed['grant'], $sealed['mac'], $turn, 7, 'files_read', ['file' => '/secret']));

        $retargeted = $sealed['grant'];
        $retargeted['after']['server_uuid'] = '11111111-2222-3333-4444-555555555555';
        $this->assertNull(AssistGrant::verify($retargeted, $sealed['mac'], $turn, 7, 'files_read', $arguments));
    }

    public function testOpeningFailsClosedWhenTheCustomerVisibleAuditCannotBeWritten(): void
    {
        $admin = User::factory()->make(['id' => 7]);
        $server = $this->server();
        $binding = $this->binding();
        $arguments = ['server' => $server->uuid, 'reason' => $binding->reason, 'ticket' => 2];
        $sealed = AssistGrant::seal(
            AssistGrant::PHASE_OPEN,
            null,
            $binding,
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            7,
            AdminTools::ASSIST_SERVER,
            $arguments,
        );

        $context = new AgentContext($admin, null, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
        $context->pendingAssistGrant = AssistGrant::verify(
            $sealed['grant'],
            $sealed['mac'],
            $context->turnId,
            7,
            AdminTools::ASSIST_SERVER,
            $arguments,
        );

        $authorizer = \Mockery::mock(AssistAuthorizer::class);
        $authorizer->shouldReceive('permitted')->once()->with($admin)->andReturnTrue();
        $authorizer->shouldReceive('resolveServer')->once()->with($server->uuid)->andReturn($server);
        $authorizer->shouldReceive('record')->once()->andThrow(new \RuntimeException('activity unavailable'));

        $runner = (new \ReflectionClass(AgentRunner::class))->newInstanceWithoutConstructor();
        (new \ReflectionProperty(AgentRunner::class, 'assist'))->setValue($runner, $authorizer);

        try {
            (new \ReflectionMethod(AgentRunner::class, 'openAssist'))->invoke($runner, $context, $arguments, fn () => null);
            $this->fail('Opening should fail when its audit record cannot be created.');
        } catch (\RuntimeException $e) {
            $this->assertSame('activity unavailable', $e->getMessage());
        }

        $this->assertNull($context->assist);
        $this->assertNull($context->targetServer());
    }

    public function testEscalationKeepsReadOnlyAuthorityWhenItsAuditCannotBeWritten(): void
    {
        $admin = User::factory()->make(['id' => 7]);
        $server = $this->server();
        $before = $this->binding();
        $after = $before->escalated();
        $arguments = ['reason' => 'Apply the ticketed fix'];
        $turn = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        $sealed = AssistGrant::seal(AssistGrant::PHASE_ESCALATE, $before, $after, $turn, 7, AdminTools::ASSIST_ALLOW_WRITES, $arguments);

        $context = new AgentContext($admin, null, $turn);
        $context->bindAssist($before, $server);
        $context->pendingAssistGrant = AssistGrant::verify(
            $sealed['grant'],
            $sealed['mac'],
            $turn,
            7,
            AdminTools::ASSIST_ALLOW_WRITES,
            $arguments,
        );

        $authorizer = \Mockery::mock(AssistAuthorizer::class);
        $authorizer->shouldReceive('permitted')->once()->with($admin)->andReturnTrue();
        $authorizer->shouldReceive('record')->once()->andThrow(new \RuntimeException('activity unavailable'));

        $runner = (new \ReflectionClass(AgentRunner::class))->newInstanceWithoutConstructor();
        (new \ReflectionProperty(AgentRunner::class, 'assist'))->setValue($runner, $authorizer);

        try {
            (new \ReflectionMethod(AgentRunner::class, 'escalateAssist'))->invoke($runner, $context, $arguments, fn () => null);
            $this->fail('Escalation should fail when its audit record cannot be created.');
        } catch (\RuntimeException $e) {
            $this->assertSame('activity unavailable', $e->getMessage());
        }

        $this->assertNotNull($context->assist);
        $this->assertFalse($context->assist->writable);
        $this->assertFalse($context->assist->permits(Permission::ACTION_FILE_UPDATE));
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

    public function testRuntimeContextNamesTheServerAndInstructionsNameTheEscalationTool(): void
    {
        $user = User::factory()->make(['id' => 7, 'username' => 'support-jo']);

        $context = new AgentContext($user, null, 'turn-1');
        $context->bindAssist($this->binding(), $this->server());

        $builder = app(SystemPromptBuilder::class);
        $instructions = $builder->build($context);
        $runtime = $builder->runtimeContext($context);

        $this->assertStringContainsString('Survival SMP', $runtime);
        $this->assertStringContainsString('read only', $runtime);
        $this->assertStringContainsString('"ticket_id": 2', $runtime);
        $this->assertStringNotContainsString('Survival SMP', $instructions);
        $this->assertStringContainsString('admin_assist_allow_writes', $instructions);
    }

    public function testThePromptSaysNothingAboutServersWhenNoSessionIsOpen(): void
    {
        $user = User::factory()->make(['id' => 7, 'username' => 'support-jo']);

        $context = new AgentContext($user, null, 'turn-1');
        $builder = app(SystemPromptBuilder::class);
        $prompt = $builder->build($context);

        $this->assertStringNotContainsString('Survival SMP', $prompt);
        $this->assertStringNotContainsString('read and write', $prompt);
        $this->assertStringNotContainsString('Survival SMP', $builder->runtimeContext($context));
        // It is still told how to get there, so it does not simply give up on a
        // ticket about a server.
        $this->assertStringContainsString('admin_assist_server', $prompt);
    }
}
