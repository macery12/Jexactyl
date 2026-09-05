<?php

namespace Everest\Services\AI\Agent;

/**
 * A working-set change that was refused, leaving the existing set untouched.
 *
 * Returned rather than thrown because the model is the one that has to act on
 * it, and the recovery — drop something, or ask for less — is a move it can
 * make. Naming the tools that would not fit is the whole point: "too many tools"
 * teaches nothing, and a model told only that will try the same load again.
 */
class PlanFailure
{
    public const TOOL_SET_TOO_LARGE = 'tool_set_too_large';

    /**
     * @param string[] $conflicting the names that could not be accommodated
     * @param string[] $required what is holding the budget — reserved tools and
     *                           existing pins, so the model can see what to drop
     */
    public function __construct(
        public readonly string $code,
        public readonly string $message,
        public readonly array $conflicting = [],
        public readonly array $required = [],
        public readonly int $budget = 0,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'conflicting' => $this->conflicting,
            'already_held' => $this->required,
            'budget' => $this->budget,
            'next' => 'Drop what you no longer need with load_tools, or ask for fewer tools at once.',
        ]);
    }
}
