<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\ToolResult;

/**
 * Stops a turn that is going round in circles.
 *
 * Step and wall-clock limits already bound a turn, but they bound it *badly* for
 * this failure: a model repeating one call twelve times burns the whole budget
 * and then reports a timeout, which tells the user nothing and tells the operator
 * to raise a limit that was never the problem. What actually happened is that the
 * model asked the same question twelve times and got the same answer.
 *
 * Retrieval makes this more likely, not less. A model that cannot find a tool
 * tends to search for it again in almost the same words, and a prerequisite it
 * cannot satisfy is a wall it will walk into repeatedly. So the guard is part of
 * this change rather than a separate hardening pass.
 *
 * **What counts as identical.** The tool, its arguments, the outcome, a digest of
 * the result, and the turn's state version. That last term is what keeps
 * legitimate repetition working: polling `server_status` through a restart
 * returns different bytes, and a call made after an approval, a phase change or a
 * new pin is a different call even when it looks the same. Pagination is fine
 * without any of that, because its arguments differ.
 */
class ProgressGuard
{
    /**
     * How many identical calls before the turn is stopped.
     *
     * One repeat earns a warning the model can act on; the second is proof it
     * cannot. A single strike would be wrong — a model that repeats a call once
     * and then does something sensible is common, and killing that turn would
     * trade a rare loop for a frequent misfire.
     */
    private const STRIKES = 2;

    public function __construct(private DiscoveryRecorder $recorder)
    {
    }

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
     * Decide what to do about a call that has just produced a result.
     *
     * Returns the result to feed back — either the real one, or a `repeated_call`
     * error in its place — and whether the loop should stop.
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
            $this->recorder->repeatStop($context, $tool);

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
     *
     * Called wherever the world may have moved: a successful mutation, a phase
     * transition, an answered question. Being generous here is the safe
     * direction — a missed bump stops a legitimate retry, which is a visible
     * failure, while an extra bump merely lets one redundant call through.
     */
    public function stateChanged(AgentContext $context): void
    {
        ++$context->stateVersion;
    }

    /**
     * The identity of one call-and-result.
     *
     * Arguments are canonicalised — keys sorted, recursively — so that a model
     * writing the same call with its fields in a different order is recognised as
     * the same call. Without that the guard is trivially defeated by a
     * re-serialisation nobody intended.
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
