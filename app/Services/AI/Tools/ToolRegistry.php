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
     * @param string[] $activeGroups
     * @param callable(ToolDefinition): bool $permitted
     *
     * @return ToolDefinition[]
     */
    private function offered(string $scope, array $activeGroups, callable $permitted): array
    {
        $disabled = $this->riskGate->disabledTools();
        $available = [];

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

        return true;
    }

    /**
     * Whether the acting user may run a tool on the surface the turn is bound
     * to. The one place resume has to ask, since an operator may have changed
     * the user's access while an approval was outstanding.
     */
    public function canUse(User $user, ?Server $server, ToolDefinition $definition): bool
    {
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
     * call, `scopeBindings()` 404s a child that is not under the named parent,
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
}
