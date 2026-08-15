<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * What the model is actually handed.
 *
 * Two failures live here, and they compounded. The offered set was capped by
 * slicing the tail, and the tail was `activate_tool_group` — so on a server turn
 * for a fully-permissioned user the one tool that could reach any of the others
 * was the one dropped, and every grouped tool became unreachable. Underneath
 * that, the base set was partitioned by feature area rather than by what a tool
 * does, so the always-offered tools were mostly writes while the cheap reads
 * that answer most questions were the ones behind the gate that no longer
 * opened.
 *
 * The result was an agent that could delete a directory without ceremony but
 * could not say which port the server listened on.
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

    /**
     * A user who holds every permission — the case that used to break, because
     * it is the one that produces the largest offering.
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

    /**
     * @param AiTool[] $tools
     *
     * @return string[]
     */
    private function names(array $tools): array
    {
        return array_map(static fn (AiTool $tool) => $tool->name, $tools);
    }

    /**
     * The runner's own pipeline: offer, cap the definitions, then shape them.
     *
     * Ordered exactly as `AgentRunner::loop()` does it, because the two halves
     * only compose correctly in that order — capping after `toAiTools()` cannot
     * tell a base tool from a grouped one, and capping the meta-tool at all
     * defeats the mechanism the cap exists to serve.
     *
     * @param string[] $active
     *
     * @return string[]
     */
    private function offeredToModel(array $active = [], ?int $max = null): array
    {
        if ($max !== null) {
            config()->set('modules.ai.agent.max_tools', $max);
        }

        $registry = $this->registry();
        $user = $this->user();
        $server = $this->server();

        $capped = $this->capDefinitions($registry->forServer($user, $server, $active));

        return $this->names($registry->toAiTools(
            $capped,
            $registry->availableGroups($user, $server, $active),
        ));
    }

    /**
     * @param ToolDefinition[] $definitions
     *
     * @return ToolDefinition[]
     */
    private function capDefinitions(array $definitions): array
    {
        $context = new AgentContext($this->user(), $this->server(), 'turn-offering-test');
        $method = new \ReflectionMethod(AgentRunner::class, 'capDefinitions');

        return $method->invoke(app(AgentRunner::class), $context, $definitions);
    }

    /**
     * @return AiTool[]
     */
    private function serverOffering(): array
    {
        $registry = $this->registry();
        $user = $this->user();
        $server = $this->server();

        return $registry->toAiTools(
            $registry->forServer($user, $server),
            $registry->availableGroups($user, $server),
        );
    }

    /*
    |--------------------------------------------------------------------------
    | The cap
    |--------------------------------------------------------------------------
    */

    /**
     * The regression itself, stated as the arithmetic that produced it: an
     * offering one tool over the cap, truncated from the end.
     */
    public function testTheToolThatLoadsOtherToolsSurvivesTheCap(): void
    {
        $offered = $this->serverOffering();

        $this->assertContains(
            ToolRegistry::META_ACTIVATE_GROUP,
            $this->names($offered),
            'The loop should offer the meta-tool while any group is dormant.'
        );

        // One under what the offering needs, so the cap certainly bites.
        $kept = $this->offeredToModel([], count($offered) - 3);

        $this->assertContains(ToolRegistry::META_ACTIVATE_GROUP, $kept);
        $this->assertContains(SharedTools::ASK_USER, $kept);
    }

    /**
     * Squeezed as far as the setting goes, the exempt tools are still there.
     *
     * `maxTools()` floors at four however low the setting is set, so the
     * smallest possible offering is those four plus the two exemptions — an
     * agent with almost nothing to work with can still ask for a tool or ask a
     * person, which are the two ways out of having nothing to work with.
     */
    public function testTheExemptToolsSurviveEvenTheSmallestCap(): void
    {
        $kept = $this->offeredToModel([], 1);

        $this->assertCount(6, $kept);
        $this->assertContains(ToolRegistry::META_ACTIVATE_GROUP, $kept);
        $this->assertContains(SharedTools::ASK_USER, $kept);
    }

    /**
     * The exemption is a reservation, not a bonus: it must not let the scoped
     * set run over the number the operator configured.
     */
    public function testTheCapCountsScopedToolsOnly(): void
    {
        $kept = $this->offeredToModel([], 6);

        $scoped = array_diff($kept, [ToolRegistry::META_ACTIVATE_GROUP, SharedTools::ASK_USER]);

        $this->assertCount(6, $scoped);
        $this->assertCount(8, $kept);
    }

    /**
     * An offering that fits is returned whole, and the exempt tools do not get
     * shuffled to the front of a set that was already ordered.
     */
    public function testAnOfferingUnderTheCapIsUntouched(): void
    {
        $this->assertSame(
            $this->names($this->serverOffering()),
            $this->offeredToModel([], 999),
        );
    }

    /*
    |--------------------------------------------------------------------------
    | The partition
    |--------------------------------------------------------------------------
    */

    /**
     * Every read is offered without an activation step.
     *
     * These are the tools that answer the questions users actually ask, and
     * each was previously behind a group: "what port am I on", "do I have
     * backups", "which plugins are installed", "what version is this".
     */
    public function testEveryReadOnlyServerToolIsOfferedUpFront(): void
    {
        $names = $this->names($this->serverOffering());

        foreach (ServerTools::all() as $definition) {
            if ($definition->risk !== ToolDefinition::RISK_SAFE) {
                continue;
            }

            $this->assertContains(
                $definition->name,
                $names,
                sprintf('%s only reads, so it should never need unlocking.', $definition->name)
            );
        }
    }

    /**
     * Nothing behind a group is a read, which is the same rule from the other
     * side — it is what stops a future tool being filed by feature area out of
     * habit and quietly disappearing again.
     */
    public function testNothingGatedIsMerelyARead(): void
    {
        foreach (ServerTools::all() as $definition) {
            if ($definition->group === null) {
                continue;
            }

            $this->assertNotSame(
                ToolDefinition::RISK_SAFE,
                $definition->risk,
                sprintf('%s is read-only and should not sit behind a group.', $definition->name)
            );
        }
    }

    /**
     * Every group named in a meta-tool description resolves to real tools.
     *
     * The enum the model chooses from is built from the description map, so a
     * group described but never assigned is an option that silently does
     * nothing — the agent spends a step, gains no tool, and tries again.
     */
    public function testEveryDescribedGroupHasToolsInIt(): void
    {
        $assigned = [];
        foreach (ServerTools::all() as $definition) {
            if ($definition->group !== null) {
                $assigned[$definition->group] = true;
            }
        }

        $this->assertSame(
            array_keys(ServerTools::GROUP_DESCRIPTIONS),
            array_keys($assigned),
            'The described groups and the assigned ones have drifted apart.'
        );
    }

    /**
     * A group activation adds tools rather than replacing them: the reads the
     * agent used to decide it needed the group have to still be there when it
     * comes to use it.
     */
    public function testActivatingAGroupWidensTheOffering(): void
    {
        $registry = $this->registry();
        $user = $this->user();
        $server = $this->server();

        $before = array_map(
            static fn (ToolDefinition $d) => $d->name,
            $registry->forServer($user, $server)
        );

        $after = array_map(
            static fn (ToolDefinition $d) => $d->name,
            $registry->forServer($user, $server, [ServerTools::GROUP_FILES_EDIT])
        );

        $this->assertContains('files_delete', $after);
        $this->assertNotContains('files_delete', $before);
        $this->assertSame(
            $before,
            array_values(array_intersect($after, $before)),
            'Activating a group must add to the offering, not reshuffle what was there.'
        );
    }

    /**
     * Activating a group must not cost the agent a read.
     *
     * This is the bug the previous ordering created, one level up from the one
     * it fixed: grouped tools went to the front, the cap truncated from the
     * back, and so asking for "backups" on a full offering silently removed
     * `databases_list`, `schedules_list` and `files_download_url` — the last of
     * those being needed by the very group that displaced it.
     *
     * The two halves fail differently, which is why they are not ranked against
     * each other at all. A missing read reads to the model as a capability the
     * panel does not have, so it stops; a group that only partly loaded is a
     * fact it can be told, and is.
     */
    public function testTheBaseSetIsReservedAgainstAnActivation(): void
    {
        $active = [ServerTools::GROUP_FILES_EDIT, ServerTools::GROUP_BACKUPS];

        $base = $this->offeredToModel([], 999);

        // Exactly enough room for the base set and not one tool more, so the
        // two groups cannot fit and the cap has to choose. Derived rather than
        // hardcoded: a cap below the base set is a different branch — it
        // truncates and warns, because an operator who set it that low meant it.
        $cap = count(array_diff($base, [ToolRegistry::META_ACTIVATE_GROUP]));

        $kept = $this->offeredToModel($active, $cap);

        foreach ($base as $name) {
            // The meta-tool is the one thing allowed to disappear here, and not
            // because of the cap: with every group already active there is
            // nothing left for it to load, so the registry stops offering it.
            if ($name === ToolRegistry::META_ACTIVATE_GROUP) {
                continue;
            }

            $this->assertContains(
                $name,
                $kept,
                sprintf('%s was offered before the activation and must survive it.', $name)
            );
        }

        $grouped = array_filter(
            ServerTools::all(),
            static fn (ToolDefinition $d) => in_array($d->group, $active, true)
        );

        $this->assertNotEmpty($grouped, 'The fixture needs groups with tools in them.');
        $this->assertNotEmpty(
            array_diff(array_map(static fn (ToolDefinition $d) => $d->name, $grouped), $kept),
            'This cap cannot fit both halves, so something grouped must have been dropped.'
        );
    }

    /**
     * An activation that did not fully fit says so.
     *
     * Silence here is indistinguishable from the activation having failed: the
     * agent asks for backups, the next step offers no backup tool, and the only
     * conclusion available to it is that the panel is broken. Naming what did
     * not load also gives it something it can act on.
     */
    public function testAnActivationReportsWhatDidNotFit(): void
    {
        config()->set('modules.ai.agent.max_tools', 12);

        $context = new AgentContext($this->user(), $this->server(), 'turn-activation-test');
        $context->activeGroups = [ServerTools::GROUP_BACKUPS];

        $method = new \ReflectionMethod(AgentRunner::class, 'activationReport');
        $report = $method->invoke(app(AgentRunner::class), $context, ServerTools::GROUP_BACKUPS);

        $this->assertSame(ServerTools::GROUP_BACKUPS, $report['activated']);
        $this->assertArrayHasKey('not_loaded', $report, 'A cap this low cannot fit the group.');
        $this->assertNotEmpty($report['not_loaded']);
        $this->assertArrayHasKey('note', $report);
    }

    /**
     * Room to spare means nothing to report, so the model is not handed a
     * caveat about a limit it never reached.
     */
    public function testAnActivationThatFitsReportsNoShortfall(): void
    {
        config()->set('modules.ai.agent.max_tools', 999);

        $context = new AgentContext($this->user(), $this->server(), 'turn-activation-fits');
        $context->activeGroups = [ServerTools::GROUP_BACKUPS];

        $method = new \ReflectionMethod(AgentRunner::class, 'activationReport');
        $report = $method->invoke(app(AgentRunner::class), $context, ServerTools::GROUP_BACKUPS);

        $this->assertArrayNotHasKey('not_loaded', $report);
        $this->assertNotEmpty($report['tools']);
    }
}
