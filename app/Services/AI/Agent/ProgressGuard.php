<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\ToolResult;

/**
 * Stops a turn that is going round in circles.
 *
 * Step and wall-clock limits bound a turn badly for this failure: a model
 * repeating one call twelve times burns the budget and reports a timeout, which
 * tells the operator to raise a limit that was never the problem. Retrieval
 * makes it likelier — a model that cannot find a tool searches again in almost
 * the same words, and an unsatisfiable prerequisite is a wall it walks into
 * repeatedly.
 *
 * **What counts as identical:** the tool, its arguments, the outcome, a digest
 * of the result, and the turn's state version. That last term keeps legitimate
 * repetition working — polling through a restart returns different bytes, and a
 * call after an approval or phase change is a different call. Pagination differs
 * by arguments alone.
 */
class ProgressGuard
{
    /**
     * How many identical calls before the turn is stopped. One repeat earns a
     * warning the model can act on; the second is proof it cannot. A single
     * strike would trade a rare loop for a frequent misfire, since repeating
     * once and then recovering is common.
     */
    private const STRIKES = 2;

    /**
     * Fold a completed call into the turn's history.
     */
    public function record(AgentContext $context, string $tool, array $arguments, ToolResult $result): void
    {
        $context->callSignatures[] = $this->signature($context, $tool, $arguments, $result);
    }

    /**
     * How many times in a row this exact call has already been made.
     */
    public function repeats(AgentContext $context, string $tool, array $arguments, ToolResult $result): int
    {
        $signature = $this->signature($context, $tool, $arguments, $result);
        $repeats = 0;

        // Consecutive only. A call made, then something else, then the same call
        // again is a model re-checking its work, which is legitimate — it is the
        // unbroken run that means nothing is happening.
        foreach (array_reverse($context->callSignatures) as $previous) {
            if ($previous !== $signature) {
                break;
            }

            ++$repeats;
        }

        return $repeats;
    }

    /**
     * Decide what to do about a call that has just produced a result: the result
     * to feed back (the real one, or a `repeated_call` error in its place) and
     * whether the loop should stop.
     *
     * @return array{result: ToolResult, halt: bool}
     */
    public function evaluate(AgentContext $context, string $tool, array $arguments, ToolResult $result): array
    {
        $repeats = $this->repeats($context, $tool, $arguments, $result);

        $this->record($context, $tool, $arguments, $result);

        if ($repeats === 0) {
            return ['result' => $result, 'halt' => false];
        }

        if ($repeats >= self::STRIKES) {
            return [
                'result' => ToolResult::error(
                    'repeated_call',
                    sprintf(
                        'That is the third identical %s call with nothing changing in between. Stopping. '
                            . 'Tell the user what you found and what is blocking you.',
                        $tool,
                    ),
                ),
                'halt' => true,
            ];
        }

        return [
            'result' => ToolResult::error(
                'repeated_call',
                sprintf(
                    'You already called %s with these arguments and got this exact result. Nothing has '
                        . 'changed since, so calling it again will return the same thing. Either do '
                        . 'something else, or answer with what you have.',
                    $tool,
                ),
            ),
            'halt' => false,
        ];
    }

    /**
     * Bump the state version, so identical calls stop counting as repetition.
     * Called wherever the world may have moved — a successful mutation, a phase
     * transition, an answered question. Generosity is the safe direction: a
     * missed bump blocks a legitimate retry, an extra one lets a redundant call
     * through.
     */
    public function stateChanged(AgentContext $context): void
    {
        ++$context->stateVersion;
    }

    /**
     * The identity of one call-and-result. Arguments are canonicalised (keys
     * sorted, recursively) so the same call written with its fields reordered is
     * still recognised — otherwise an unintended re-serialisation defeats the
     * guard.
     */
    private function signature(AgentContext $context, string $tool, array $arguments, ToolResult $result): string
    {
        return hash('sha256', implode('|', [
            $tool,
            json_encode($this->canonicalise($arguments)),
            $result->outcome,
            hash('sha256', (string) json_encode($result->data)),
            $context->stateVersion,
        ]));
    }

    private function canonicalise(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        $canonical = array_map(fn ($item) => $this->canonicalise($item), $value);

        // Only associative arrays are sorted. Reordering a list would make two
        // genuinely different calls — deleting [a, b] and deleting [b, a] — look
        // identical, and the second of those is not a no-op.
        if (!array_is_list($canonical)) {
            ksort($canonical);
        }

        return $canonical;
    }
}
