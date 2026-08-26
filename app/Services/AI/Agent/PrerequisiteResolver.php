<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\Prerequisite;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\AdminTools;

/**
 * What has to happen before a tool can run, and which tool makes it happen.
 *
 * Exists for the chain models cannot infer: reading a customer's startup command
 * needs a resolved server, then an approved read-only session, then
 * `startup_list`. Without it the model does not make a wrong call — it announces
 * that the panel cannot read startup commands.
 *
 * **The cross-surface rule is derived, not declared.** A server-scoped tool on
 * an admin turn always needs an assist session, and `AssistBinding::WRITE_TOOLS`
 * decides whether it must be writable. That is a fact about the two surfaces,
 * and writing it onto fifty-odd definitions is how one missed rename would make
 * a write reachable from a read-only session. `ToolDiscovery::$prerequisites`
 * covers the genuine exceptions, currently one.
 *
 * Nothing here grants anything: it returns gateway tool *names*, and those
 * gateways still suspend for approval, re-check `SERVERS_ASSIST` and write the
 * customer-visible activity row.
 */
class PrerequisiteResolver
{
    /**
     * Which tool satisfies each prerequisite. `SERVER_CONTEXT` has no gateway on
     * purpose — an admin turn cannot become a server turn, so the honest answer
     * is to say so rather than offer a route that does not exist.
     */
    private const GATEWAYS = [
        Prerequisite::SELECTED_SERVER => 'admin_servers_list',
        Prerequisite::READ_ASSIST => AdminTools::ASSIST_SERVER,
        Prerequisite::WRITE_ASSIST => AdminTools::ASSIST_ALLOW_WRITES,
        Prerequisite::TICKET_CONTEXT => AdminTools::ASSIST_SERVER,
        Prerequisite::SERVER_CONTEXT => null,
    ];

    /**
     * Everything between the current state and calling this tool, outermost
     * first, so the model can act on the first entry without reasoning about the
     * rest. Unordered, this would put "ask for write access" in front of a model
     * with no session to widen.
     *
     * @return array<int, array{prerequisite: string, tool: string, reason: string}>
     */
    public function unmet(AgentContext $context, ToolDefinition $definition): array
    {
        $unmet = [];

        foreach ($this->required($context, $definition) as $prerequisite) {
            if ($this->satisfied($context, $prerequisite)) {
                continue;
            }

            $gateway = self::GATEWAYS[$prerequisite] ?? null;

            if ($gateway === null) {
                continue;
            }

            $unmet[] = [
                'prerequisite' => $prerequisite,
                'tool' => $gateway,
                'reason' => Prerequisite::reason($prerequisite),
            ];
        }

        return $unmet;
    }

    public function isReachable(AgentContext $context, ToolDefinition $definition): bool
    {
        foreach ($this->required($context, $definition) as $prerequisite) {
            if ($this->satisfied($context, $prerequisite)) {
                continue;
            }

            // A prerequisite with no gateway cannot be met from here, so the tool
            // is not reachable at all — as opposed to reachable after a step,
            // which is what everything else means.
            if ((self::GATEWAYS[$prerequisite] ?? null) === null) {
                return false;
            }
        }

        return true;
    }

    public function availableNow(AgentContext $context, ToolDefinition $definition): bool
    {
        return $this->unmet($context, $definition) === []
            && $this->isReachable($context, $definition);
    }

    /**
     * The gateway tools a pinned target drags in with it, so a turn that found
     * `startup_list` on an admin surface also holds the two tools it needs to
     * get there.
     *
     * @return string[]
     */
    public function gateways(AgentContext $context, ToolDefinition $definition): array
    {
        return array_values(array_unique(array_column($this->unmet($context, $definition), 'tool')));
    }

    /**
     * Everything this tool requires on this surface — declared and derived.
     *
     * @return string[] ordered outermost-first
     */
    private function required(AgentContext $context, ToolDefinition $definition): array
    {
        $required = [];

        if ($definition->scope === ToolDefinition::SCOPE_SERVER) {
            if ($context->scope() === ToolDefinition::SCOPE_SERVER) {
                // The turn is bound to a server already. Nothing to arrange.
                $required[] = Prerequisite::SERVER_CONTEXT;
            } else {
                $required[] = Prerequisite::SELECTED_SERVER;
                $required[] = Prerequisite::READ_ASSIST;

                if (in_array($definition->name, AssistBinding::WRITE_TOOLS, true)) {
                    $required[] = Prerequisite::WRITE_ASSIST;
                }
            }
        }

        // Declared prerequisites go last: they are refinements on a tool that is
        // otherwise reachable, and putting them first would tell an admin to find
        // a ticket before finding the server the ticket is about.
        foreach ($definition->prerequisites() as $declared) {
            if (!in_array($declared, $required, true)) {
                $required[] = $declared;
            }
        }

        return $required;
    }

    /**
     * Whether the turn is already in the state a prerequisite names. Read off the
     * live context every time: a binding can be dropped mid-turn, and a cached
     * "read assist is satisfied" would outlive the authority that made it true.
     */
    private function satisfied(AgentContext $context, string $prerequisite): bool
    {
        $binding = $context->assist;
        $bound = $binding !== null && $context->targetServer() !== null;

        return match ($prerequisite) {
            Prerequisite::SERVER_CONTEXT => $context->server !== null,
            Prerequisite::SELECTED_SERVER => $context->server !== null || $bound,
            Prerequisite::READ_ASSIST => $context->server !== null || $bound,
            Prerequisite::WRITE_ASSIST => $context->server !== null || ($bound && $binding->writable),
            // Only inside a live session. The rule is about staying on the
            // subject a session was opened for, and outside one there is no
            // subject to stray from — the administrator is on the admin surface,
            // reading the panel's own records, where the ticket listing and the
            // ticket view are already unrestricted under `tickets.read`.
            //
            // Requiring a session unconditionally was a deadlock rather than a
            // boundary: `tickets` has no body column, so every word a customer
            // wrote lives in `ticket_messages`. A ticket whose `server_id` is
            // null — every ticket raised before that column existed — names its
            // server only in the conversation, so the agent had to open an
            // approved session on the server it was trying to identify *from*
            // that conversation. The observable result was an assistant that
            // listed tickets over and over and never knew what any of them said.
            //
            // Nothing is relaxed in-session: this still bites there, and
            // `AgentRunner::assistSubjectAllows()` separately refuses a ticket
            // that is not the bound one.
            Prerequisite::TICKET_CONTEXT => !$bound || $binding->ticketId !== null,
            default => true,
        };
    }
}
