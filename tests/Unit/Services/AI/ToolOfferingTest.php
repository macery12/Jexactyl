<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Agent\WorkingSet;
use Everest\Services\AI\Agent\PlanFailure;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\WorkingSetPlanner;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\PrerequisiteResolver;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * What the model is actually handed.
 *
 * This file used to be about a cap that truncated a tail. The tail was
 * `activate_tool_group`, so a fully-permissioned server turn dropped the one
 * tool that could reach any of the others and every grouped tool became
 * unreachable — while the base set, partitioned by feature area rather than by
 * what a tool does, kept the writes and gated the cheap reads. The result was an
 * agent that could delete a directory without ceremony but could not say which
 * port the server listened on.
 *
 * Nothing truncates now. `WorkingSetPlanner` builds a set in priority order and
 * refuses a change it cannot make whole, so the tests here are about that
 * refusal and about the priority — the two properties the old design lacked.
 */
class ToolOfferingTest extends TestCase
{
    private function registry(): ToolRegistry
    {
        $authorizer = \Mockery::mock(AdminAuthorizer::class);
        $authorizer->shouldReceive('hasCapability')->andReturn(true);
        $authorizer->shouldReceive('isOwner')->andReturn(true);

        return new ToolRegistry(new RiskGate(new ConsoleCommandGate()), new SchemaValidator(), $authorizer);
    }

    private function planner(): WorkingSetPlanner
    {
        return new WorkingSetPlanner($this->registry(), new PrerequisiteResolver());
    }

    /**
     * A user who holds every permission — the case that produces the largest
     * catalogue, and the one the old cap broke on.
     */
    private function user(): User
    {
        $user = \Mockery::mock(User::class)->makePartial();
        $user->shouldReceive('can')->andReturn(true);

        return $user;
    }

    private function server(): Server
    {
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';

        return $server;
    }

    private function context(bool $admin = false): AgentContext
    {
        return new AgentContext(
            $this->user(),
            $admin ? null : $this->server(),
            'turn-offering-test',
        );
    }

    /*
    |--------------------------------------------------------------------------
    | The tools that are never spent against the budget
    |--------------------------------------------------------------------------
    */

    /**
     * Discovery and the safety exits survive a budget of nothing.
     *
     * The direct successor to the failure this file was written for. Then it was
     * `activate_tool_group` being sliced off the tail; now it is `search_tools`,
     * and the consequence would be identical and worse — a model that cannot
     * reach the catalogue at all, on a working set that is by design a fraction
     * of it.
     */
    public function testTheAlwaysOfferedToolsSurviveAnEmptyBudget(): void
    {
        $offered = $this->planner()->plan($this->context(), 0)->names();

        foreach (SharedTools::ALWAYS_OFFERED as $name) {
            $this->assertContains($name, $offered, $name . ' must never be spent against the budget.');
        }
    }

    /**
     * They are not counted, either. Being offered and being charged for are
     * separate, and a budget of 8 has to mean eight *capabilities*.
     */
    public function testTheAlwaysOfferedToolsAreNotCountedAgainstTheBudget(): void
    {
        $set = $this->planner()->plan($this->context(), 6);

        $this->assertLessThanOrEqual(6, $set->billableSize());
        $this->assertGreaterThan(6, $set->size(), 'The exempt tools should be offered on top of the budget.');
    }

    /*
    |--------------------------------------------------------------------------
    | Priority
    |--------------------------------------------------------------------------
    */

    /**
     * A phase opens with the reads its surface actually needs.
     */
    public function testAPhaseReservesItsOwnToolsFirst(): void
    {
        $offered = $this->planner()->plan($this->context(), 4)->names();

        foreach (WorkingSet::RESERVED[WorkingSet::PHASE_SERVER] as $name) {
            $this->assertContains($name, $offered);
        }
    }

    /**
     * A pinned tool outranks a merely-retrieved one.
     *
     * The whole point of the two tiers. A search returns the tool the model
     * wanted plus some neighbours, and when the budget runs out it must be the
     * neighbours that go — not the thing the turn is holding on to.
     */
    public function testAPinOutranksARetrievedSuggestion(): void
    {
        $context = $this->context();
        $context->pin('backups_list', 'the user asked about backups');
        $context->setRetrieved(['files_compress', 'files_rename', 'files_copy', 'databases_list']);

        $offered = $this->planner()->plan($context, 3)->names();

        $this->assertContains('backups_list', $offered);
        $this->assertNotContains('files_copy', $offered);
    }

    /**
     * A pin the budget cannot hold is *named*, not dropped in silence.
     *
     * Silence is the original sin here. A model cannot tell a tool that was
     * removed from a tool that never existed, so it reports that the panel
     * cannot do something it can — and the user believes it.
     */
    public function testAPinThatWillNotFitIsReported(): void
    {
        $context = $this->context();

        foreach (['backups_list', 'databases_list', 'schedules_list', 'allocations_list'] as $name) {
            $context->pin($name, 'test');
        }

        $set = $this->planner()->plan($context, 2);

        $this->assertNotEmpty($set->dropped, 'A pin that did not fit must appear in dropped.');

        foreach ($set->dropped as $name) {
            $this->assertNotContains($name, $set->names());
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Atomicity
    |--------------------------------------------------------------------------
    */

    /**
     * A load that will not fit changes nothing at all.
     *
     * The property the doc calls for and the cap could not provide: append-then-
     * truncate would have let a wide load evict whatever the turn was already
     * holding, which is the eviction the design forbids outright.
     */
    public function testAnOversizedLoadLeavesTheExistingSetUntouched(): void
    {
        $context = $this->context();
        $context->pin('backups_list', 'the user asked about backups');
        $before = $context->pinned;

        $failure = $this->planner()->propose(
            $context,
            ['files_compress', 'files_rename', 'files_copy', 'files_delete', 'files_create_folder'],
            [],
            2,
        );

        $this->assertInstanceOf(PlanFailure::class, $failure);
        $this->assertSame(PlanFailure::TOOL_SET_TOO_LARGE, $failure->code);
        $this->assertNotEmpty($failure->conflicting, 'The refusal has to name what would not fit.');
        $this->assertSame($before, $context->pinned, 'A refused load must not have changed the pins.');
    }

    /**
     * Dropping makes room, which is what keeps a refusal recoverable.
     */
    public function testDroppingAToolMakesRoomForAnother(): void
    {
        $context = $this->context();
        $context->pin('backups_list', 'test');
        $context->pin('databases_list', 'test');

        $plan = $this->planner()->propose($context, ['schedules_list'], ['backups_list'], 3);

        $this->assertIsArray($plan);
        $this->assertContains('schedules_list', $plan['pinned']);
        $this->assertNotContains('backups_list', $plan['pinned']);
        $this->assertContains('backups_list', $plan['dropped']);
    }

    /**
     * A budget that can hold the whole surface holds the whole surface.
     *
     * Retrieval is what a *small* budget needs. A frontier model given 32 slots
     * against a 26-tool surface should behave exactly as the panel did before any
     * of this existed — making it search for something it could simply have been
     * shown is a step spent and a chance to search badly. This is the one thing
     * the old `groupsInPlay()` had right, and it is kept.
     */
    public function testAGenerousBudgetOffersTheWholeSurface(): void
    {
        $planner = $this->planner();
        $context = $this->context();

        $callable = array_keys($planner->callable($context));
        $offered = $planner->plan($context, 64)->names();

        sort($callable);
        sort($offered);

        $this->assertSame($callable, $offered);
    }

    /**
     * ...and the fill never displaces a pin on a budget that cannot.
     */
    public function testTheCatalogueFillIsSpentLast(): void
    {
        $context = $this->context();
        $context->pin('backup_restore', 'the user asked to roll back');

        $offered = $this->planner()->plan($context, 3)->names();

        $this->assertContains('backup_restore', $offered);
    }

    /*
    |--------------------------------------------------------------------------
    | Reachability
    |--------------------------------------------------------------------------
    */

    /**
     * A server tool is never *offered* on an admin turn, however it was pinned.
     *
     * Discovery deliberately advertises these — that is how "read their startup
     * command" finds `startup_list` — so the boundary has to hold one step later,
     * at the point a schema would be handed over. It does, because the offered
     * set is built from what is callable now and an unapproved session makes
     * nothing callable.
     */
    public function testAnAdminTurnIsNotOfferedServerToolsWithoutASession(): void
    {
        $context = $this->context(admin: true);
        $context->pin('startup_list', 'the administrator asked about a startup command');

        $offered = $this->planner()->plan($context, 12)->names();

        $this->assertNotContains('startup_list', $offered);
        $this->assertNotContains('files_read', $offered);
    }

    /**
     * ...but the gateway that would make it reachable *is* offered.
     *
     * Half of the previous test on its own would be a regression rather than a
     * boundary: refusing the tool and offering nothing to do about it is exactly
     * the dead end retrieval was supposed to remove.
     */
    public function testAPinnedServerToolPullsInItsGateway(): void
    {
        $context = $this->context(admin: true);
        $context->pin('startup_list', 'the administrator asked about a startup command');

        $offered = $this->planner()->plan($context, 12)->names();

        $this->assertContains('admin_assist_server', $offered);
    }

    /**
     * The catalogue search looks through is wider than the set it can offer.
     */
    public function testTheAdminCatalogueIncludesReachableServerTools(): void
    {
        $catalogue = array_map(
            fn (ToolDefinition $d) => $d->name,
            $this->planner()->catalogue($this->context(admin: true)),
        );

        $this->assertContains('startup_list', $catalogue, 'Search has to be able to find it.');
        $this->assertContains('admin_servers_list', $catalogue);
    }

    /**
     * A server tool no session could ever grant is not advertised either.
     *
     * The catalogue is bounded by `AssistBinding`'s own lists rather than by
     * scope, so a tool outside every grant — deletion, which is deliberately
     * absent from both — cannot be surfaced as though an approval would reach it.
     */
    public function testTheAdminCatalogueExcludesToolsNoSessionCanGrant(): void
    {
        $catalogue = array_map(
            fn (ToolDefinition $d) => $d->name,
            $this->planner()->catalogue($this->context(admin: true)),
        );

        $this->assertNotContains('files_delete', $catalogue);
        $this->assertNotContains('backup_delete', $catalogue);
    }

    /*
    |--------------------------------------------------------------------------
    | Budget profiles
    |--------------------------------------------------------------------------
    */

    /**
     * Every profile leaves room to work in.
     *
     * A profile whose budget the server phase's reserved set alone exhausted
     * would offer a model no slot for the tool it went and found, which is the
     * one arrangement retrieval cannot recover from.
     */
    public function testEveryProfileLeavesRoomBeyondItsReservedSet(): void
    {
        $largestPhase = max(array_map('count', WorkingSet::RESERVED));

        foreach (ToolBudget::profiles() as $profile => $limits) {
            $this->assertGreaterThan(
                $largestPhase,
                $limits['schemas'],
                sprintf('The %s profile reserves its whole budget before finding anything.', $profile),
            );

            $this->assertLessThan(
                $limits['schemas'],
                $limits['results'],
                sprintf('A %s search must not be able to replace the whole working set.', $profile),
            );
        }
    }

    /*
    |--------------------------------------------------------------------------
    | AI-032 — a tool that authorises per argument
    |--------------------------------------------------------------------------
    |
    | `SendPowerRequest::permission()` resolves start, stop/kill and restart onto
    | three separate permissions, so no single required permission describes
    | `server_power`. Naming `control.restart` flatly got both halves wrong: it
    | hid the tool from every start-only or stop-only user, and offered all four
    | signals to a restart-only one.
    */

    public function testEverySinglePowerPermissionIsOfferedThePowerTool(): void
    {
        $registry = $this->registry();
        $definition = $registry->find('server_power');
        $server = $this->server();

        foreach ([
            \Everest\Models\Permission::ACTION_CONTROL_START,
            \Everest\Models\Permission::ACTION_CONTROL_STOP,
            \Everest\Models\Permission::ACTION_CONTROL_RESTART,
        ] as $held) {
            $this->assertTrue(
                $registry->userCanUse($this->userHolding([$held]), $server, $definition),
                $held . ' alone is a valid power permission and must not hide the tool.',
            );
        }
    }

    public function testAUserWithNoPowerPermissionIsNotOfferedThePowerTool(): void
    {
        $registry = $this->registry();

        $this->assertFalse($registry->userCanUse(
            $this->userHolding([\Everest\Models\Permission::ACTION_FILE_READ]),
            $this->server(),
            $registry->find('server_power'),
        ));
    }

    /**
     * The any-of rule is opt-in. Every other tool still needs all of what it
     * declares, which is the property the boundary has always rested on.
     */
    public function testAllOfPermissionsAreStillRequiredEverywhereElse(): void
    {
        $registry = $this->registry();
        $write = $registry->find('files_write');

        $this->assertNotEmpty($write->permissions);
        $this->assertSame([], $write->anyPermission);
        $this->assertFalse($registry->userCanUse($this->userHolding([]), $this->server(), $write));
    }

    /**
     * An assist session is judged against its ability list rather than the
     * administrator's own access, and the same rule has to apply there —
     * escalation grants all three power abilities.
     */
    public function testAnAssistSessionAppliesTheSameAnyOfRule(): void
    {
        $registry = $this->registry();
        $definition = $registry->find('server_power');

        $this->assertTrue($registry->assistPermits(
            $definition,
            ['server_power'],
            [\Everest\Models\Permission::ACTION_CONTROL_START],
        ));

        $this->assertFalse($registry->assistPermits(
            $definition,
            ['server_power'],
            [\Everest\Models\Permission::ACTION_FILE_READ],
        ));
    }

    /** @param string[] $permissions */
    private function userHolding(array $permissions): User
    {
        $user = \Mockery::mock(User::class)->makePartial();
        $user->shouldReceive('can')->andReturnUsing(
            static fn (string $permission) => in_array($permission, $permissions, true)
        );

        return $user;
    }
}
