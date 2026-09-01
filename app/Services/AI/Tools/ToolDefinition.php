<?php

namespace Everest\Services\AI\Tools;

use Everest\Services\AI\Data\AiTool;

/**
 * One tool the agent may call.
 *
 * Carries both the model-facing contract (name, description, argument schema)
 * and the panel-side concerns the model must never see (route, risk tier,
 * required permission). `toAiTool()` is the only thing that crosses into a
 * prompt, which is what keeps route and permission detail out of the context.
 */
class ToolDefinition
{
    /**
     * Reads. Run without asking — they change nothing and the permission
     * system already decides what the user may see.
     */
    public const RISK_SAFE = 'safe';

    /**
     * Mutations that are recoverable. Rendered as an approval card; file
     * writes show a real diff before anything is sent.
     */
    public const RISK_WRITE = 'write';

    /**
     * Data loss, or actions that interrupt players. Require typed confirmation
     * naming the server.
     */
    public const RISK_DESTRUCTIVE = 'destructive';

    public const RISKS = [self::RISK_SAFE, self::RISK_WRITE, self::RISK_DESTRUCTIVE];

    public const SCOPE_SERVER = 'server';
    public const SCOPE_ADMIN = 'admin';

    /**
     * Offered on every surface. Only meaningful for host-handled tools, which
     * touch no API and therefore have no scope of their own.
     */
    public const SCOPE_SHARED = 'shared';

    /**
     * @param string $uriTemplate path with `{server}` substituted from the turn's
     *                            bound context — never from model output. Empty
     *                            for a host-handled tool.
     * @param string[] $permissions checked before dispatch as defence in depth; the
     *                              endpoint's own gate remains authoritative. For an
     *                              admin-scoped tool these are AdminRole capabilities
     *                              rather than subuser permissions.
     * @param string[] $anyPermission holding *one* of these is enough to be offered
     *                                the tool, for endpoints that authorise per
     *                                argument (`server_power` maps start/stop/restart
     *                                onto three permissions). A flat list would either
     *                                hide the tool or offer signals the endpoint
     *                                refuses. Shapes the catalogue only; the endpoint
     *                                remains the boundary.
     * @param ToolDiscovery|null $discovery how the tool is found — aliases, tags,
     *                                      category. Absent means it is reachable only
     *                                      by its exact registered name.
     * @param callable|null $resultShaper trims a raw response down to what the model needs
     * @param bool $sharesHumanThrottle set for endpoints behind a literal `throttle:n,m`,
     *                                  which no limiter callback can exempt
     * @param bool $hostHandled resolved by the runner itself rather than dispatched.
     *                          Declared here rather than synthesised at prompt time
     *                          so it still appears in the admin tool catalogue and
     *                          obeys the operator's disable list.
     */
    public function __construct(
        public readonly string $name,
        public readonly string $description,
        public readonly array $parameters,
        public readonly string $method,
        public readonly string $uriTemplate,
        public readonly string $risk = self::RISK_SAFE,
        public readonly string $scope = self::SCOPE_SERVER,
        public readonly array $permissions = [],
        public readonly array $anyPermission = [],
        public readonly ?ToolDiscovery $discovery = null,
        public readonly mixed $resultShaper = null,
        public readonly bool $sharesHumanThrottle = false,
        public readonly array $bodyFields = [],
        public readonly array $queryFields = [],
        public readonly bool $hostHandled = false,
    ) {
    }

    /**
     * Whether this tool is offered on the given surface.
     */
    public function inScope(string $scope): bool
    {
        return $this->scope === $scope || $this->scope === self::SCOPE_SHARED;
    }

    /**
     * The domain this tool files under, for the operator's catalogue and as one
     * more token for retrieval to match on. `uncategorised` rather than null so
     * callers never have to special-case a tool whose author forgot.
     */
    public function category(): string
    {
        return $this->discovery === null ? 'uncategorised' : $this->discovery->category;
    }

    /**
     * The words a person would use for this tool.
     *
     * @return string[]
     */
    public function aliases(): array
    {
        return $this->discovery === null ? [] : $this->discovery->aliases;
    }

    /**
     * Coarse facets that broaden a query without answering it.
     *
     * @return string[]
     */
    public function tags(): array
    {
        return $this->discovery === null ? [] : $this->discovery->tags;
    }

    /**
     * The one-line description a search result carries. Never the full schema —
     * that is what entering the working set buys.
     */
    public function summary(): string
    {
        if ($this->discovery !== null) {
            return $this->discovery->summary($this->description);
        }

        return preg_split('/(?<=[.!?])\s+/', trim($this->description), 2)[0] ?? $this->description;
    }

    /**
     * Prerequisites declared on the tool itself. Nearly always empty: the
     * cross-surface chain is *derived* by `PrerequisiteResolver` from scope and
     * risk, being a rule about the two surfaces rather than about any one tool.
     *
     * @return string[]
     */
    public function prerequisites(): array
    {
        return $this->discovery === null ? [] : $this->discovery->prerequisites;
    }

    /**
     * The model-facing view. Route, risk, and permissions are deliberately
     * absent — a prompt has no business carrying them.
     */
    public function toAiTool(): AiTool
    {
        return new AiTool($this->name, $this->description, $this->parameters ?: AiTool::emptySchema());
    }

    public function isRead(): bool
    {
        return in_array(strtoupper($this->method), ['GET', 'HEAD'], true);
    }

    /**
     * Whether this tool runs without asking the user first.
     */
    public function isAutomatic(string $effectiveRisk): bool
    {
        return $effectiveRisk === self::RISK_SAFE;
    }

    /**
     * Build a dispatchable invocation from validated model arguments.
     *
     * `$context` supplies the bound identifiers (the server uuid). Arguments
     * are split into query and body by the definition's own declaration rather
     * than by guessing, so a model cannot smuggle a body field into a GET.
     */
    public function invoke(array $arguments, array $context): ToolInvocation
    {
        $uri = $this->uriTemplate;
        foreach ($context as $key => $value) {
            $uri = str_replace('{' . $key . '}', rawurlencode((string) $value), $uri);
        }

        $query = [];
        foreach ($this->queryFields as $field) {
            if (array_key_exists($field, $arguments)) {
                $query[$field] = $arguments[$field];
            }
        }

        $body = [];
        foreach ($this->bodyFields as $field) {
            if (array_key_exists($field, $arguments)) {
                $body[$field] = $arguments[$field];
            }
        }

        return new ToolInvocation($this->name, $this->method, $uri, $query, $body);
    }

    /**
     * Apply the result shaper, if any. Shapers exist because raw panel
     * responses are sized for a UI, not a context window — a directory listing
     * can carry ten thousand entries.
     */
    public function shape(ToolResult $result, array $arguments = []): ToolResult
    {
        if (!$result->ok || !is_callable($this->resultShaper)) {
            return $result;
        }

        $shaped = ($this->resultShaper)($result->data, $arguments);

        // Most shapers only replace the raw data. A small number need to
        // describe a deliberately partial result (a page or line range) before
        // the generic byte cap runs, so they may return the complete result.
        return $shaped instanceof ToolResult
            ? $shaped
            : ToolResult::ok($shaped, $result->truncated);
    }
}
