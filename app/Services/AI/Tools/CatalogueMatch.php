<?php

namespace Everest\Services\AI\Tools;

/**
 * One search result: a tool, why it scored, and what stands between the agent
 * and calling it.
 *
 * `requires` is the part that makes retrieval usable rather than merely
 * impressive. A model told only that `startup_list` exists, on a surface where
 * it cannot yet be run, will call it, be refused, and call it again — the doc's
 * whole §9 exists because of that loop. Told instead that it needs an approved
 * session and which tool opens one, it has something to do next.
 */
class CatalogueMatch
{
    /**
     * @param int $score the rank this match was found at. Retained because the
     *                   planner spends its budget on the highest first, and
     *                   because a tie broken by name is the only way an identical
     *                   query returns an identical answer twice.
     * @param array<int, array{tool: string, reason: string}> $requires ordered
     *                                                                  outermost-first: the first entry is the one to act on now
     */
    public function __construct(
        public readonly ToolDefinition $definition,
        public readonly int $score,
        public readonly bool $availableNow = true,
        public readonly array $requires = [],
    ) {
    }

    public function name(): string
    {
        return $this->definition->name;
    }

    public function withRequirements(bool $availableNow, array $requires): self
    {
        return new self($this->definition, $this->score, $availableNow, $requires);
    }

    /**
     * The model-facing shape.
     *
     * Deliberately thin: a name, one line, and what is in the way. The full
     * parameter schema is what entering the working set buys, and sending it here
     * would spend the context that retrieval exists to save — eight results with
     * schemas attached is most of the catalogue again.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $entry = [
            'name' => $this->definition->name,
            'summary' => $this->definition->summary(),
            'available_now' => $this->availableNow,
        ];

        if ($this->requires !== []) {
            $entry['requires'] = $this->requires;
        }

        return $entry;
    }
}
