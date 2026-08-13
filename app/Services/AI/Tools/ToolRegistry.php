<?php

namespace Everest\Services\AI\Tools;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\Definitions\ServerTools;

/**
 * The explicit allowlist of everything the agent may do.
 *
 * A registry rather than route introspection on purpose: the panel exposes
 * hundreds of endpoints, and "everything not forbidden is permitted" is the
 * wrong default for a system driven by model output. Anything absent here is
 * simply not reachable, regardless of what the user's own permissions allow.
 */
class ToolRegistry
{
    /**
     * Meta-tool the agent calls to pull in a group of tools it needs. Keeps
     * the offered set small — local models degrade sharply past roughly
     * fifteen tools — without hiding capability behind a config flag.
     */
    public const META_ACTIVATE_GROUP = 'activate_tool_group';

    /** @var array<string, ToolDefinition>|null */
    private ?array $indexed = null;

    public function __construct(
        private RiskGate $riskGate,
        private SchemaValidator $validator,
    ) {
    }

    /**
     * @return array<string, ToolDefinition>
     */
    public function all(): array
    {
        if ($this->indexed !== null) {
            return $this->indexed;
        }

        $indexed = [];
        foreach (ServerTools::all() as $definition) {
            $indexed[$definition->name] = $definition;
        }

        return $this->indexed = $indexed;
    }

    public function find(string $name): ?ToolDefinition
    {
        return $this->all()[$name] ?? null;
    }

    /**
     * The tools offered for one turn on one server.
     *
     * Filtered by what the acting user may actually do, so the model is never
     * shown a capability it would only be refused on. That filtering is a UX
     * and token-efficiency measure, not the security boundary — the endpoint's
     * own permission gate remains authoritative on every call.
     *
     * @param string[] $activeGroups groups the agent has pulled in this turn
     *
     * @return ToolDefinition[]
     */
    public function forServer(User $user, Server $server, array $activeGroups = []): array
    {
        $disabled = $this->riskGate->disabledTools();
        $available = [];

        foreach ($this->all() as $definition) {
            if ($definition->scope !== ToolDefinition::SCOPE_SERVER) {
                continue;
            }

            if (in_array($definition->name, $disabled, true)) {
                continue;
            }

            // Grouped tools stay hidden until the agent asks for the group.
            if ($definition->group !== null && !in_array($definition->group, $activeGroups, true)) {
                continue;
            }

            if (!$this->userCanUse($user, $server, $definition)) {
                continue;
            }

            $available[] = $definition;
        }

        return $available;
    }

    /**
     * Whether the acting user holds every permission a tool needs.
     */
    public function userCanUse(User $user, Server $server, ToolDefinition $definition): bool
    {
        foreach ($definition->permissions as $permission) {
            if (!$user->can($permission, $server)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Groups that hold at least one tool this user could use, so the meta-tool
     * only ever advertises groups that would actually yield something.
     *
     * @return array<string, string> group => description
     */
    public function availableGroups(User $user, Server $server, array $activeGroups = []): array
    {
        $disabled = $this->riskGate->disabledTools();
        $groups = [];

        foreach ($this->all() as $definition) {
            if ($definition->group === null || in_array($definition->group, $activeGroups, true)) {
                continue;
            }

            if (in_array($definition->name, $disabled, true)) {
                continue;
            }

            if (!$this->userCanUse($user, $server, $definition)) {
                continue;
            }

            $groups[$definition->group] = ServerTools::GROUP_DESCRIPTIONS[$definition->group] ?? $definition->group;
        }

        return $groups;
    }

    /**
     * Build the model-facing tool list, appending the group meta-tool when
     * there is anything left to activate.
     *
     * @param ToolDefinition[] $definitions
     * @param array<string, string> $groups
     *
     * @return AiTool[]
     */
    public function toAiTools(array $definitions, array $groups = []): array
    {
        $tools = array_map(fn (ToolDefinition $d) => $d->toAiTool(), $definitions);

        if ($groups !== []) {
            $tools[] = $this->groupMetaTool($groups);
        }

        return $tools;
    }

    /**
     * @param array<string, string> $groups
     */
    public function groupMetaTool(array $groups): AiTool
    {
        $lines = [];
        foreach ($groups as $name => $description) {
            $lines[] = sprintf('"%s" — %s', $name, $description);
        }

        return new AiTool(
            self::META_ACTIVATE_GROUP,
            "Load an additional set of tools for this conversation. Call this when the task needs a capability you do not currently have a tool for. Available:\n" . implode("\n", $lines),
            [
                'type' => 'object',
                'properties' => [
                    'group' => [
                        'type' => 'string',
                        'enum' => array_keys($groups),
                        'description' => 'The tool group to load.',
                    ],
                ],
                'required' => ['group'],
            ]
        );
    }

    /**
     * Validate and coerce model-supplied arguments.
     *
     * @return array{valid: bool, errors: array<int, string>, value: array}
     */
    public function validate(ToolDefinition $definition, array $arguments): array
    {
        return $this->validator->validate($arguments, $definition->parameters);
    }

    /**
     * The context identifiers a server-scoped tool interpolates into its URI.
     *
     * This is the mechanism that confines the agent: the server uuid comes
     * from the route the turn was opened on, never from the model, and no
     * server-scoped schema accepts one as an argument.
     */
    public function serverContext(Server $server, array $arguments = []): array
    {
        $context = ['server' => $server->uuid];

        // Sub-resource identifiers (a backup uuid, say) are model-supplied but
        // still scoped: ResourceBelongsToServer 404s anything that is not part
        // of this server.
        foreach (['backup', 'database', 'schedule', 'allocation'] as $key) {
            if (isset($arguments[$key]) && is_scalar($arguments[$key])) {
                $context[$key] = (string) $arguments[$key];
            }
        }

        return $context;
    }
}
