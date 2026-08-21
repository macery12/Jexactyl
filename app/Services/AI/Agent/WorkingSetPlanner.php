<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * Decides which tools the model sees this step. Two rules do the work:
 *
 * - **Priority, not order.** Built from the top: discovery and safety exits, the
 *   phase's reserved reads, what the turn has pinned, the gateways those pins
 *   need, then whatever a search turned up. The old cap sliced a tail off a
 *   statically-ordered list, so what got dropped depended on where a tool
 *   happened to be written down.
 * - **Refuse rather than truncate.** A set that cannot hold what a turn requires
 *   is a planning failure naming the missing tools, not a shorter set — to a
 *   model, a missing tool and a nonexistent one are the same observation.
 *
 * Nothing here decides authority: candidates have already passed
 * `ToolRegistry`'s permission filter, pins are re-filtered every step, and being
 * reserved buys only a place in the queue.
 */
class WorkingSetPlanner
{
    public function __construct(
        private ToolRegistry $registry,
        private PrerequisiteResolver $prerequisites,
    ) {
    }

    /**
     * Everything reachable on this surface, whether or not it can be called yet.
     * What search looks through, deliberately wider than what can be offered: an
     * admin turn includes the customer-server tools an approved session would
     * unlock, so "read their startup command" finds `startup_list` and is told
     * what stands in the way. Safe because they are not callable — the offered
     * set comes from `callable()`, and `AgentRunner` refuses anything absent.
     *
     * @return ToolDefinition[]
     */
    public function catalogue(AgentContext $context): array
    {
        $callable = $this->callable($context);

        if ($context->scope() === ToolDefinition::SCOPE_SERVER || !$this->canOpenAssist($context)) {
            return array_values($callable);
        }

        // Server tools an approved session would reach. Bounded by the binding
        // constants rather than by scope, so discovery can never advertise a
        // server tool no session is allowed to grant in the first place.
        $reachable = array_merge(AssistBinding::READ_TOOLS, AssistBinding::WRITE_TOOLS);

        foreach ($this->registry->all() as $definition) {
            if (isset($callable[$definition->name])) {
                continue;
            }

            if (!in_array($definition->name, $reachable, true)) {
                continue;
            }

            if ($this->registry->isDisabled($definition->name)) {
                continue;
            }

            $callable[$definition->name] = $definition;
        }

        return array_values($callable);
    }

    /**
     * What the acting user may run right now, on this surface, in this phase, and
     * the one place assist narrowing lives. During a session the admin half of
     * the catalogue collapses to the companion tools — those answering a question
     * *about* this server or its reporter — since panel-wide browsing is not part
     * of diagnosing a server, and its budget belongs to the session's own tools.
     *
     * @return array<string, ToolDefinition>
     */
    public function callable(AgentContext $context): array
    {
        if ($context->server !== null) {
            return $this->keyed($this->registry->forServer($context->user, $context->server));
        }

        $admin = $this->registry->forAdmin($context->user);

        $binding = $context->assist;

        if ($binding === null || $context->targetServer() === null) {
            // Escalation is meaningless with no session to escalate, and a tool
            // the model cannot use is a tool it will try anyway.
            return $this->keyed(array_filter(
                $admin,
                fn (ToolDefinition $d) => $d->name !== AdminTools::ASSIST_ALLOW_WRITES,
            ));
        }

        // `ASSIST_SERVER` stays reachable in the read phase: a ticket can name
        // two servers, and opening a session on the second one is a legitimate
        // move. It goes in the writable phase, where there is no wider grant left
        // to ask for and the tool that opens a session is noise while one is
        // already open on the server the turn is about.
        $companions = $binding->writable
            ? AssistBinding::WRITABLE_COMPANION_TOOLS
            : array_merge(
                AssistBinding::COMPANION_TOOLS,
                [AdminTools::ASSIST_SERVER, AdminTools::ASSIST_ALLOW_WRITES],
            );

        // A binding opened without a ticket has no ticket subject, and leaving
        // the panel-wide ticket readers in that phase would make any model-chosen
        // ticket id look like an ordinary automatic read.
        if ($binding->ticketId === null) {
            $companions = array_diff($companions, ['admin_ticket_view', 'admin_ticket_messages']);
        }

        $kept = array_filter(
            $admin,
            fn (ToolDefinition $d) => in_array($d->name, $companions, true)
                // A session that cannot ask which of two fixes to apply will pick
                // one, on someone else's server.
                || $d->scope === ToolDefinition::SCOPE_SHARED,
        );

        return $this->keyed(array_merge(
            $this->registry->forAssist($binding->tools(), $binding->abilities),
            array_values($kept),
        ));
    }

    /**
     * Build the offered set for one step.
     *
     * Never fails. By the time a step runs, the pins have already been through
     * {@see propose()} and are known to fit; what this handles is the budget
     * moving underneath them — an operator disabling a tool, an assist session
     * closing, a phase change bringing a wider reserved set. In that case the
     * oldest pins give way and are named in `dropped`, because a pin that
     * disappeared without explanation is the failure this replaced.
     */
    public function plan(AgentContext $context, int $budget): WorkingSet
    {
        $callable = $this->callable($context);
        $phase = $context->phase;

        $offered = [];
        $dropped = [];

        // Tier 1: never capped. Not capability — the way out of a position the
        // agent cannot otherwise leave, and the way it reaches everything else.
        foreach (SharedTools::ALWAYS_OFFERED as $name) {
            if (isset($callable[$name])) {
                $offered[$name] = $callable[$name];
            }
        }

        $room = max(0, $budget);
        $overflow = [];

        $take = function (array $names) use (&$offered, &$room, &$overflow, $callable) {
            foreach ($names as $name) {
                if (isset($offered[$name]) || !isset($callable[$name])) {
                    continue;
                }

                if ($room <= 0) {
                    $overflow[] = $name;

                    continue;
                }

                $offered[$name] = $callable[$name];
                --$room;
            }
        };

        // Tiers 2-4. Reserved first: these are the reads a turn on this surface
        // opens with, and a pinned target that needs one of them would otherwise
        // arrive without it.
        $take(WorkingSet::RESERVED[$phase] ?? []);
        $take($this->reachablePins($context, $callable));
        $take($this->gatewayPins($context, $callable));

        // Tier 5: the rest of what a search turned up. A secondary search result
        // is a suggestion, not something the turn is holding on to, so it goes
        // quietly when there is no room.
        $take($context->retrieved);

        // Tier 6: fill whatever is left with the phase's most-wanted tools. An
        // empty slot is worth nothing, and leaving them empty would make every
        // question on a quiet turn cost a search before it could cost an answer.
        $take(WorkingSet::PREFERRED[$phase] ?? []);

        // Tier 7: if the whole catalogue still fits, offer the whole catalogue.
        //
        // A frontier model with a budget of 32 and a 26-tool surface can hold
        // everything, and making it search for a tool it could simply have been
        // shown is pure overhead — a step spent, and a chance to search badly.
        // Retrieval is what a *small* budget needs; a large one should behave
        // exactly as the panel did before it existed. This is the one insight
        // the old `groupsInPlay()` had right, kept.
        //
        // Ordered last, so it can only ever use slots nothing else wanted.
        $take(array_keys($callable));

        foreach ($overflow as $name) {
            if (in_array($name, $context->pinned, true)) {
                $dropped[] = $name;
            }
        }

        return new WorkingSet(
            array_values($offered),
            $phase,
            array_values(array_intersect($context->pinned, array_keys($offered))),
            array_values(array_unique($dropped)),
        );
    }

    /**
     * Test a proposed set of new pins without committing it — the atomic half of
     * the design. A load happens whole or not at all: resolve the names, expand
     * what they need, add to what is pinned, and check the total against the
     * budget *before* anything changes. Appending then trimming would let a
     * billing lookup evict the assist session a turn was building toward.
     *
     * @param string[] $names tools the model asked for
     * @param string[] $drop tools it is finished with
     *
     * @return PlanFailure|array{pinned: string[], gateways: string[], dropped: string[]}
     */
    public function propose(AgentContext $context, array $names, array $drop, int $budget): PlanFailure|array
    {
        $callable = $this->callable($context);
        $catalogue = $this->keyed($this->catalogue($context));

        $pinned = array_values(array_diff($context->pinned, $drop));

        foreach ($names as $name) {
            if (!isset($catalogue[$name]) || in_array($name, $pinned, true)) {
                continue;
            }

            $pinned[] = $name;
        }

        $gateways = [];
        foreach ($pinned as $name) {
            if (!isset($catalogue[$name])) {
                continue;
            }

            foreach ($this->prerequisites->gateways($context, $catalogue[$name]) as $gateway) {
                if (!in_array($gateway, $gateways, true) && !in_array($gateway, $pinned, true)) {
                    $gateways[] = $gateway;
                }
            }
        }

        // What the proposal actually costs: only the tools that would occupy a
        // schema slot this step. A pinned target that is still waiting on a
        // session is free until the session exists, which is what lets a small
        // budget hold a plan several steps long.
        $required = array_unique(array_merge(
            array_intersect(WorkingSet::RESERVED[$context->phase] ?? [], array_keys($callable)),
            array_values(array_filter($pinned, fn (string $n) => isset($callable[$n]))),
            array_values(array_filter($gateways, fn (string $n) => isset($callable[$n]))),
        ));

        if (count($required) > $budget) {
            $conflicting = array_values(array_slice(
                array_values(array_intersect($names, $required)),
                0
            ));

            return new PlanFailure(
                PlanFailure::TOOL_SET_TOO_LARGE,
                sprintf(
                    'Loading %s would need %d tools at once and this model is limited to %d. Nothing was changed.',
                    implode(', ', $names),
                    count($required),
                    $budget,
                ),
                $conflicting !== [] ? $conflicting : $names,
                array_values(array_diff($required, $names)),
                $budget,
            );
        }

        return [
            'pinned' => $pinned,
            'gateways' => $gateways,
            'dropped' => array_values(array_intersect($drop, $context->pinned)),
        ];
    }

    /**
     * Pinned tools that can be called right now. A pin whose prerequisites are
     * unmet stays pinned but unoffered — it is what the turn is working toward,
     * and offering a schema the panel would refuse teaches the model the tool is
     * broken rather than that the session is missing.
     *
     * @param array<string, ToolDefinition> $callable
     *
     * @return string[]
     */
    private function reachablePins(AgentContext $context, array $callable): array
    {
        $reachable = [];

        foreach ($context->pinned as $name) {
            $definition = $callable[$name] ?? null;

            if ($definition !== null && $this->prerequisites->availableNow($context, $definition)) {
                $reachable[] = $name;
            }
        }

        return $reachable;
    }

    /**
     * The gateways a pinned-but-unreachable target needs, in dependency order.
     *
     * @param array<string, ToolDefinition> $callable
     *
     * @return string[]
     */
    private function gatewayPins(AgentContext $context, array $callable): array
    {
        $catalogue = $this->keyed($this->catalogue($context));
        $gateways = [];

        foreach ($context->pinned as $name) {
            $definition = $catalogue[$name] ?? null;

            if ($definition === null) {
                continue;
            }

            foreach ($this->prerequisites->gateways($context, $definition) as $gateway) {
                if (isset($callable[$gateway]) && !in_array($gateway, $gateways, true)) {
                    $gateways[] = $gateway;
                }
            }
        }

        return $gateways;
    }

    /**
     * Whether this administrator could open a session at all.
     *
     * Asked by resolving the gateway tool through the ordinary permission filter
     * rather than by checking the capability directly, so that an operator who
     * disabled `admin_assist_server` also stops customer-server tools being
     * advertised on the admin surface. Two facts that should never disagree, kept
     * from disagreeing by only having one of them.
     */
    private function canOpenAssist(AgentContext $context): bool
    {
        $gateway = $this->registry->find(AdminTools::ASSIST_SERVER);

        return $gateway !== null
            && !$this->registry->isDisabled($gateway->name)
            && $this->registry->adminCanUse($context->user, $gateway);
    }

    /**
     * @param ToolDefinition[] $definitions
     *
     * @return array<string, ToolDefinition>
     */
    private function keyed(array $definitions): array
    {
        $keyed = [];

        foreach ($definitions as $definition) {
            $keyed[$definition->name] = $definition;
        }

        return $keyed;
    }
}
