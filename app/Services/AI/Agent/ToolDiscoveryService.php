<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Tools\ToolCatalogue;
use Everest\Services\AI\Tools\CatalogueMatch;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * The two host tools that make retrieval usable: `search_tools` and `load_tools`.
 *
 * **Search loads what it finds.** A strict search-then-load split would cost an
 * extra inference step per task, out of twelve, on exactly the small models this
 * exists to serve. Matches have already passed the permission filter that
 * decides what is offered, and putting a tool in front of the model is not
 * running it. `load_tools` covers what search is wrong for: a name the model
 * already knows, and dropping what it has finished with.
 *
 * **Exact names never lose to a guess.** `exact_name` wins outright, and a
 * registered name typed by the *user* is pinned before the turn's first
 * inference.
 */
class ToolDiscoveryService
{
    public function __construct(
        private ToolCatalogue $catalogue,
        private WorkingSetPlanner $planner,
        private PrerequisiteResolver $prerequisites,
    ) {
    }

    /**
     * Find tools, and put what is found in front of the model.
     */
    public function search(AgentContext $context, array $arguments, int $budget, int $defaultLimit): ToolResult
    {
        $query = trim((string) ($arguments['query'] ?? ''));
        $exact = trim((string) ($arguments['exact_name'] ?? ''));

        if ($query === '' && $exact === '') {
            return ToolResult::error(
                'invalid_arguments',
                'Give either a query describing what you want to do, or the exact name of a tool.',
                retryable: true,
            );
        }

        $limit = (int) ($arguments['limit'] ?? $defaultLimit);
        $limit = max(
            SharedTools::MIN_SEARCH_RESULTS,
            min(SharedTools::MAX_SEARCH_RESULTS, $limit === 0 ? $defaultLimit : $limit)
        );

        $candidates = $this->planner->catalogue($context);
        $matches = $this->catalogue->search($candidates, $query, $exact ?: null, $limit);

        if ($matches === []) {
            // Named as an error rather than an empty success. "No tool for that"
            // is a fact the model must act on — by answering that the panel
            // cannot do it — and an empty list reads as an invitation to search
            // again with different words, which is how the loop starts.
            return ToolResult::error(
                'tool_not_found',
                sprintf(
                    'Nothing matches "%s". Either the panel cannot do this, or you are not allowed to. '
                        . 'Say so rather than searching again with different words.',
                    $exact !== '' ? $exact : $query,
                ),
            );
        }

        $described = array_map(fn ($match) => $this->describe($context, $match), $matches);

        // The top match is what the model asked for; the rest are neighbours. The
        // first is pinned and held, the others are offered while there is room —
        // otherwise one broad query fills the working set with tools the turn
        // never uses and evicts the one it does.
        $primary = $described[0];
        $reason = sprintf('search: %s', $exact !== '' ? $exact : $query);

        $plan = $this->planner->propose($context, [$primary->name()], [], $budget);

        $loaded = [];

        if (!$plan instanceof PlanFailure) {
            $this->commit($context, $plan, $reason);
            $loaded[] = $primary->name();
        }

        $context->setRetrieved(array_map(fn ($m) => $m->name(), array_slice($described, 1)));

        return ToolResult::ok(array_filter([
            'matches' => array_map(fn ($m) => $m->toArray(), $described),
            'loaded' => $loaded,
            'next' => $this->nextStep($primary),
        ], fn ($value) => $value !== null && $value !== []));
    }

    /**
     * Load tools by name, and drop ones the turn is done with.
     */
    public function load(AgentContext $context, array $arguments, int $budget): ToolResult
    {
        $names = array_values(array_filter(
            array_map(fn ($n) => is_scalar($n) ? trim((string) $n) : '', (array) ($arguments['tools'] ?? [])),
        ));
        $drop = array_values(array_filter(
            array_map(fn ($n) => is_scalar($n) ? trim((string) $n) : '', (array) ($arguments['drop'] ?? [])),
        ));
        $reason = trim((string) ($arguments['reason'] ?? '')) ?: 'load_tools';

        if ($names === []) {
            return ToolResult::error('invalid_arguments', 'Name at least one tool to load.', retryable: true);
        }

        $catalogue = [];
        foreach ($this->planner->catalogue($context) as $definition) {
            $catalogue[$definition->name] = $definition;
        }

        $unknown = array_values(array_diff($names, array_keys($catalogue)));

        if ($unknown !== []) {
            // Refused whole rather than loading the half that resolved. A partial
            // load leaves the model believing it holds something it does not, and
            // the next call fails somewhere less legible than here.
            return ToolResult::error(
                'tool_not_found',
                sprintf(
                    'No tool called %s is available here. Use search_tools to find what you want by description.',
                    implode(', ', array_map(fn ($n) => '"' . $n . '"', $unknown)),
                ),
                retryable: true,
            );
        }

        $plan = $this->planner->propose($context, $names, $drop, $budget);

        if ($plan instanceof PlanFailure) {
            return ToolResult::error(
                $plan->code,
                $plan->message,
                retryable: true,
                fields: $plan->toArray(),
            );
        }

        $this->commit($context, $plan, $reason);

        $callable = $this->planner->callable($context);

        $now = [];
        $later = [];

        foreach ($plan['pinned'] as $name) {
            if (!in_array($name, $names, true)) {
                continue;
            }

            $definition = $callable[$name] ?? null;

            if ($definition !== null && $this->prerequisites->availableNow($context, $definition)) {
                $now[] = $name;
            } else {
                $later[] = $name;
            }
        }

        return ToolResult::ok(array_filter([
            'loaded' => $now,
            'pinned_for_later' => $later,
            'gateways' => $plan['gateways'],
            'removed' => $plan['dropped'],
            'next' => $later === []
                ? null
                : $this->nextStep($this->describe($context, new CatalogueMatch(
                    $catalogue[$later[0]],
                    0,
                ))),
        ], fn ($value) => $value !== null && $value !== []));
    }

    /**
     * Pin every registered tool name the user typed, before the first inference.
     *
     * Free — no model call, no step — and it removes the most annoying failure a
     * person can hit: naming a tool exactly and watching the agent go looking for
     * it. Word-boundary matching only, so prose that happens to contain a word
     * from a tool name does not drag it in.
     */
    public function pinNamedTools(AgentContext $context, string $message): void
    {
        if (trim($message) === '') {
            return;
        }

        foreach ($this->planner->catalogue($context) as $definition) {
            if (in_array($definition->name, SharedTools::ALWAYS_OFFERED, true)) {
                continue;
            }

            if (preg_match('/\b' . preg_quote($definition->name, '/') . '\b/i', $message) !== 1) {
                continue;
            }

            $context->pin($definition->name, 'named by the user');

            foreach ($this->prerequisites->gateways($context, $definition) as $gateway) {
                $context->pin($gateway, sprintf('needed before %s', $definition->name));
            }
        }
    }

    /**
     * Pin exact tool names plus precise, human-facing intent phrases before the
     * first inference. Aliases shorter than three words stay search-only: broad
     * phrases such as "pricing" or "list users" are too easy to mention while
     * asking for a different operation. Longer aliases are deliberate routing
     * phrases and remove an avoidable search step for requests such as "create
     * a free plan".
     */
    public function pinUserIntentTools(AgentContext $context, string $message): void
    {
        $this->pinNamedTools($context, $message);

        if (trim($message) === '') {
            return;
        }

        foreach ($this->planner->catalogue($context) as $definition) {
            if (in_array($definition->name, $context->pinned, true)) {
                continue;
            }

            foreach ($definition->aliases() as $alias) {
                $words = preg_split('/\s+/', trim($alias), -1, PREG_SPLIT_NO_EMPTY) ?: [];
                if (count($words) < 3) {
                    continue;
                }

                $pattern = '/(?<![a-z0-9])'
                    . implode('\\s+', array_map(
                        static fn (string $word): string => preg_quote($word, '/'),
                        $words,
                    ))
                    . '(?![a-z0-9])/i';

                if (preg_match($pattern, $message) !== 1) {
                    continue;
                }

                $context->pin($definition->name, 'intent phrase from user');

                foreach ($this->prerequisites->gateways($context, $definition) as $gateway) {
                    $context->pin($gateway, sprintf('needed before %s', $definition->name));
                }

                break;
            }
        }
    }

    /**
     * Attach reachability to a raw match.
     */
    private function describe(AgentContext $context, CatalogueMatch $match): CatalogueMatch
    {
        $unmet = $this->prerequisites->unmet($context, $match->definition);

        return $match->withRequirements(
            $unmet === [] && $this->prerequisites->isReachable($context, $match->definition),
            array_map(fn (array $step) => [
                'tool' => $step['tool'],
                'reason' => $step['reason'],
            ], $unmet),
        );
    }

    /**
     * @param array{pinned: string[], gateways: string[], dropped: string[]} $plan
     */
    private function commit(AgentContext $context, array $plan, string $reason): void
    {
        foreach ($plan['dropped'] as $name) {
            $context->unpin($name);
        }

        foreach ($plan['pinned'] as $name) {
            $context->pin($name, $reason);
        }

        foreach ($plan['gateways'] as $gateway) {
            $context->pin($gateway, 'needed before ' . ($plan['pinned'][0] ?? 'the tool you asked for'));
        }
    }

    /**
     * One sentence telling the model what to do next.
     *
     * Present only when something stands in the way. A model told a tool is ready
     * needs no instruction to use it, and a "next" line on every result is noise
     * that trains it to skip the field on the occasions it matters.
     */
    private function nextStep(CatalogueMatch $match): ?string
    {
        if ($match->requires === []) {
            return null;
        }

        $first = $match->requires[0];

        return sprintf(
            '%s is not usable yet. %s Call %s first — it is loaded for you.',
            $match->name(),
            $first['reason'],
            $first['tool'],
        );
    }
}
