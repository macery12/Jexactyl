<?php

namespace Everest\Services\AI\Tools;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

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
        private AdminAuthorizer $authorizer,
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

        // One flat name => definition map across every scope. Admin tools are
        // prefixed `admin_` for that reason: a collision here would silently
        // shadow a tool, and the operator's risk overrides and disable list are
        // keyed by bare name too, so it would misconfigure both at once.
        foreach ([ServerTools::all(), AdminTools::all(), SharedTools::all()] as $set) {
            foreach ($set as $definition) {
                $indexed[$definition->name] = $definition;
            }
        }

        return $this->indexed = $indexed;
    }

    /**
     * Descriptions for every group across every scope, for the meta-tool and
     * the admin catalogue.
     *
     * @return array<string, string>
     */
    public function groupDescriptions(): array
    {
        return ServerTools::GROUP_DESCRIPTIONS + AdminTools::GROUP_DESCRIPTIONS;
    }

    public function find(string $name): ?ToolDefinition
    {
        return $this->all()[$name] ?? null;
    }

    public function isDisabled(string $name): bool
    {
        return in_array($name, $this->riskGate->disabledTools(), true);
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
        return $this->offered(
            ToolDefinition::SCOPE_SERVER,
            $activeGroups,
            fn (ToolDefinition $definition) => $this->userCanUse($user, $server, $definition),
        );
    }

    /**
     * The tools offered for one turn on the panel itself.
     *
     * The admin surface has no subject model to authorize against — an admin
     * acts across every user, server and product — so the filter is the acting
     * administrator's own AdminRole capabilities. As on the server side this is
     * a UX and token-efficiency measure: `AuthorizeApplicationUser` and the
     * endpoint's own `ApplicationApiRequest::authorize()` both re-check the
     * identical capability on every call.
     *
     * @param string[] $activeGroups
     *
     * @return ToolDefinition[]
     */
    public function forAdmin(User $user, array $activeGroups = []): array
    {
        return $this->offered(
            ToolDefinition::SCOPE_ADMIN,
            $activeGroups,
            fn (ToolDefinition $definition) => $this->adminCanUse($user, $definition),
        );
    }

    /**
     * The server-scoped tools an administrator's assist session may use.
     *
     * Takes plain arrays rather than the binding object so this file stays free
     * of any dependency on the agent loop — the registry is a catalogue, and it
     * should not need to know what an assist session is to describe one.
     *
     * Both lists have to agree for a tool to appear, and they are checked
     * independently on purpose. The names decide what the model is *shown*; the
     * abilities decide what the panel will actually *run*, and are the same
     * strings `ServerPolicy` is asked about at dispatch. A tool that appeared in
     * one list but not the other would be offered and then refused, which is
     * ugly but safe; the reverse cannot happen, because the ability list is
     * still the boundary.
     *
     * The group gate is deliberately skipped: a binding names its tools
     * outright, so there is nothing left for a group to reveal.
     *
     * @param string[] $toolNames
     * @param string[] $abilities
     *
     * @return ToolDefinition[]
     */
    public function forAssist(array $toolNames, array $abilities): array
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

            if ($this->assistPermits($definition, $toolNames, $abilities)) {
                $available[] = $definition;
            }
        }

        return $available;
    }

    /**
     * Whether one tool is within an assist session's grant.
     *
     * @param string[] $toolNames
     * @param string[] $abilities
     */
    public function assistPermits(ToolDefinition $definition, array $toolNames, array $abilities): bool
    {
        if (!in_array($definition->name, $toolNames, true)) {
            return false;
        }

        foreach ($definition->permissions as $permission) {
            if (!in_array($permission, $abilities, true)) {
                return false;
            }
        }

        return $this->holdsAnyOf($definition, fn (string $ability) => in_array($ability, $abilities, true));
    }

    /**
     * The any-of half of a tool's permission declaration.
     *
     * Empty means the tool has no such requirement, which is the common case —
     * only an endpoint that authorises per argument needs one.
     *
     * @param callable(string): bool $holds
     */
    private function holdsAnyOf(ToolDefinition $definition, callable $holds): bool
    {
        if ($definition->anyPermission === []) {
            return true;
        }

        foreach ($definition->anyPermission as $permission) {
            if ($holds($permission)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The base set first, then whatever groups are active.
     *
     * Ordering here is not a priority scheme — `AgentRunner::capDefinitions()`
     * reserves the base set outright and spends what is left on grouped tools,
     * so neither half can silently displace the other. What the ordering does is
     * keep the two halves contiguous, which is what lets the cap split them
     * without inspecting every definition twice.
     *
     * An earlier attempt put grouped tools first, on the reasoning that a tool
     * the agent explicitly asked for is better evidence of what the turn needs
     * than a static declaration order. That is true, and it is why activation is
     * now reported back rather than assumed — but as an ordering it made the cap
     * eat reads instead, which is the worse failure: a read that is missing
     * looks to the model exactly like a capability the panel does not have.
     *
     * @param string[] $activeGroups
     * @param callable(ToolDefinition): bool $permitted
     *
     * @return ToolDefinition[]
     */
    private function offered(string $scope, array $activeGroups, callable $permitted): array
    {
        $disabled = $this->riskGate->disabledTools();
        $base = [];
        $grouped = [];

        foreach ($this->all() as $definition) {
            if (!$definition->inScope($scope)) {
                continue;
            }

            if (in_array($definition->name, $disabled, true)) {
                continue;
            }

            // Grouped tools stay hidden until the agent asks for the group.
            if ($definition->group !== null && !in_array($definition->group, $activeGroups, true)) {
                continue;
            }

            if (!$permitted($definition)) {
                continue;
            }

            if ($definition->group !== null) {
                $grouped[] = $definition;

                continue;
            }

            $base[] = $definition;
        }

        return array_merge($base, $grouped);
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

        return $this->holdsAnyOf($definition, fn (string $permission) => $user->can($permission, $server));
    }

    /**
     * Whether the acting administrator holds every capability a tool needs.
     *
     * Asked through `hasCapability()` rather than by inspecting
     * `AdminAuthorizer::capabilities()`, which returns the literal `['*']` for
     * an owner — a sentinel that never matches a real capability string.
     */
    public function adminCanUse(User $user, ToolDefinition $definition): bool
    {
        foreach ($definition->permissions as $capability) {
            if (!$this->authorizer->hasCapability($user, $capability)) {
                return false;
            }
        }

        return $this->holdsAnyOf(
            $definition,
            fn (string $capability) => $this->authorizer->hasCapability($user, $capability),
        );
    }

    /**
     * Whether the acting user may run a tool on the surface the turn is bound
     * to. The one place resume has to ask, since an operator may have changed
     * the user's access while an approval was outstanding.
     */
    public function canUse(User $user, ?Server $server, ToolDefinition $definition): bool
    {
        if ($this->isDisabled($definition->name)) {
            return false;
        }

        $scope = $server === null ? ToolDefinition::SCOPE_ADMIN : ToolDefinition::SCOPE_SERVER;
        if (!$definition->inScope($scope)) {
            return false;
        }

        return $server === null
            ? $this->adminCanUse($user, $definition)
            : $this->userCanUse($user, $server, $definition);
    }

    /**
     * Groups that hold at least one tool this user could use, so the meta-tool
     * only ever advertises groups that would actually yield something.
     *
     * @return array<string, string> group => description
     */
    public function availableGroups(User $user, Server $server, array $activeGroups = []): array
    {
        return $this->groupsFor(
            ToolDefinition::SCOPE_SERVER,
            $activeGroups,
            fn (ToolDefinition $definition) => $this->userCanUse($user, $server, $definition),
        );
    }

    /**
     * @param string[] $activeGroups
     *
     * @return array<string, string> group => description
     */
    public function availableAdminGroups(User $user, array $activeGroups = []): array
    {
        return $this->groupsFor(
            ToolDefinition::SCOPE_ADMIN,
            $activeGroups,
            fn (ToolDefinition $definition) => $this->adminCanUse($user, $definition),
        );
    }

    /**
     * @param string[] $activeGroups
     * @param callable(ToolDefinition): bool $permitted
     *
     * @return array<string, string>
     */
    private function groupsFor(string $scope, array $activeGroups, callable $permitted): array
    {
        $disabled = $this->riskGate->disabledTools();
        $descriptions = $this->groupDescriptions();
        $groups = [];

        foreach ($this->all() as $definition) {
            if ($definition->group === null || in_array($definition->group, $activeGroups, true)) {
                continue;
            }

            if (!$definition->inScope($scope)) {
                continue;
            }

            if (in_array($definition->name, $disabled, true)) {
                continue;
            }

            if (!$permitted($definition)) {
                continue;
            }

            $groups[$definition->group] = $descriptions[$definition->group] ?? $definition->group;
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

    /**
     * The identifiers an admin-scoped tool interpolates into its URI.
     *
     * Unlike the server surface, these are model-supplied — an administrator
     * legitimately acts across every user, product and category, so there is no
     * route context to bind them from and no honest way to pretend otherwise.
     * The containment is different in kind rather than absent: the registry is
     * an explicit allowlist, capabilities gate the class of action on every
     * call, a child that is not under the named parent 404s at the endpoint,
     * and no admin tool is registered at DESTRUCTIVE tier.
     */
    public function adminContext(array $arguments = []): array
    {
        $context = [];

        foreach (['user', 'server', 'category', 'product', 'coupon', 'ticket', 'cycle', 'id'] as $key) {
            if (isset($arguments[$key]) && is_scalar($arguments[$key])) {
                $context[$key] = (string) $arguments[$key];
            }
        }

        return $context;
    }

    /**
     * The URI context for whichever surface the turn is bound to.
     */
    public function contextFor(?Server $server, array $arguments = []): array
    {
        return $server === null
            ? $this->adminContext($arguments)
            : $this->serverContext($server, $arguments);
    }

    /**
     * The URI context for one specific tool.
     *
     * Branches on the *tool's* scope rather than on whether a server is present,
     * which matters once an admin turn can have both. During an assist session
     * `admin_ticket_view` and `files_read` run in the same turn with a server in
     * hand, and only the second of them wants it interpolated — asking "is there
     * a server?" would feed a server uuid into the admin URI builder and quietly
     * mangle every id the model supplied.
     */
    public function contextForTool(ToolDefinition $definition, ?Server $server, array $arguments = []): array
    {
        return $definition->scope === ToolDefinition::SCOPE_SERVER && $server !== null
            ? $this->serverContext($server, $arguments)
            : $this->adminContext($arguments);
    }
}
