<?php

namespace Everest\Services\AI\Support;

use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiToolCall;

/**
 * Recovers tool calls that a model wrote as prose instead of emitting through
 * the structured tool-call channel — the highest-leverage reliability mechanism
 * for self-hosted models.
 *
 * A model that formats the right call as `<tool_call>{...}</tool_call>` or a
 * fenced JSON block has not failed; dropping the turn wastes an inference round
 * and leaves text in the history that skews every later step. Recovery is
 * unambiguous: only a candidate whose `name` matches an offered tool is taken.
 *
 * Nothing here loosens authorization — a salvaged call goes through the same
 * schema validation, risk gate and executor as a natively emitted one.
 */
class ToolCallSalvager
{
    /**
     * Wrapper tags used by the common local-model chat templates.
     */
    protected const WRAPPERS = [
        ['<tool_call>', '</tool_call>'],
        ['<function_call>', '</function_call>'],
        ['<tool▁call▁begin>', '<tool▁call▁end>'],
        ['[TOOL_CALLS]', ''],
    ];

    /**
     * Keys a model might use for the arguments object.
     */
    protected const ARGUMENT_KEYS = ['arguments', 'parameters', 'args', 'input', 'tool_input'];

    /**
     * Keys a model might use for the tool name.
     */
    protected const NAME_KEYS = ['name', 'tool', 'tool_name', 'function', 'recipient_name'];

    /**
     * Extract any tool calls embedded in an assistant message's text.
     *
     * @param AiTool[] $tools the tools that were offered this turn
     *
     * @return AiToolCall[]
     */
    public function salvage(?string $text, array $tools): array
    {
        if ($text === null || trim($text) === '') {
            return [];
        }

        $known = [];
        foreach ($tools as $tool) {
            $known[strtolower($tool->name)] = $tool->name;
        }

        if ($known === []) {
            return [];
        }

        $calls = [];
        $namespace = bin2hex(random_bytes(12));
        foreach ($this->candidates($text) as $index => $candidate) {
            $call = $this->toToolCall($candidate, $known, count($calls), $namespace);
            if ($call !== null && !$this->alreadySeen($calls, $call)) {
                $calls[] = $call;
            }
        }

        return $calls;
    }

    /**
     * Whether the text looks like it was *trying* to call a tool. Used to
     * decide whether a repair round is worth spending — text with no JSON-ish
     * structure at all is just an answer, not a malformed call.
     */
    public function looksLikeAttempt(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        foreach (self::WRAPPERS as [$open, $close]) {
            if (str_contains($text, $open)) {
                return true;
            }
        }

        return (bool) preg_match('~\{[^{}]*"(?:' . implode('|', self::NAME_KEYS) . ')"\s*:~i', $text);
    }

    /**
     * All decoded JSON objects found in the text, most-specific source first.
     *
     * @return array<int, array>
     */
    protected function candidates(string $text): array
    {
        $found = [];

        foreach ($this->wrappedPayloads($text) as $payload) {
            $found = array_merge($found, $this->decodeAny($payload));
        }

        foreach ($this->fencedPayloads($text) as $payload) {
            $found = array_merge($found, $this->decodeAny($payload));
        }

        // Bare objects anywhere in the text — the loosest source, so only
        // consulted when the structured ones yielded nothing.
        if ($found === []) {
            foreach ($this->balancedObjects($text) as $payload) {
                $found = array_merge($found, $this->decodeAny($payload));
            }
        }

        return $found;
    }

    /**
     * @return array<int, string>
     */
    protected function wrappedPayloads(string $text): array
    {
        $payloads = [];

        foreach (self::WRAPPERS as [$open, $close]) {
            $offset = 0;
            while (($start = strpos($text, $open, $offset)) !== false) {
                $from = $start + strlen($open);

                if ($close === '') {
                    $payloads[] = substr($text, $from);
                    break;
                }

                $end = strpos($text, $close, $from);
                if ($end === false) {
                    // Truncated output — take the remainder and let the JSON
                    // decoder decide whether it is usable.
                    $payloads[] = substr($text, $from);
                    break;
                }

                $payloads[] = substr($text, $from, $end - $from);
                $offset = $end + strlen($close);
            }
        }

        return $payloads;
    }

    /**
     * @return array<int, string>
     */
    protected function fencedPayloads(string $text): array
    {
        if (!preg_match_all('~```(?:json|tool_code|python)?\s*(.+?)(?:```|$)~is', $text, $matches)) {
            return [];
        }

        return $matches[1];
    }

    /**
     * Scan for brace-balanced JSON objects, respecting strings and escapes so
     * a `}` inside a value does not terminate the object early.
     *
     * @return array<int, string>
     */
    protected function balancedObjects(string $text): array
    {
        $objects = [];
        $length = strlen($text);
        $depth = 0;
        $start = null;
        $inString = false;
        $escaped = false;

        for ($i = 0; $i < $length; ++$i) {
            $char = $text[$i];

            if ($inString) {
                if ($escaped) {
                    $escaped = false;
                } elseif ($char === '\\') {
                    $escaped = true;
                } elseif ($char === '"') {
                    $inString = false;
                }

                continue;
            }

            if ($char === '"') {
                $inString = true;
            } elseif ($char === '{') {
                if ($depth === 0) {
                    $start = $i;
                }
                ++$depth;
            } elseif ($char === '}') {
                if ($depth > 0) {
                    --$depth;
                    if ($depth === 0 && $start !== null) {
                        $objects[] = substr($text, $start, $i - $start + 1);
                        $start = null;
                    }
                }
            }
        }

        return $objects;
    }

    /**
     * Decode a payload that may be a single object, an array of objects, or
     * several objects concatenated without a separator.
     *
     * @return array<int, array>
     */
    protected function decodeAny(string $payload): array
    {
        $payload = trim($payload);
        if ($payload === '') {
            return [];
        }

        $decoded = json_decode($payload, true);

        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            // A list of calls (Mistral's `[TOOL_CALLS]` form).
            if (array_is_list($decoded)) {
                return array_values(array_filter($decoded, 'is_array'));
            }

            return [$decoded];
        }

        // Not valid on its own — it may be several objects run together.
        $objects = $this->balancedObjects($payload);
        if (count($objects) <= 1) {
            return [];
        }

        $out = [];
        foreach ($objects as $object) {
            $item = json_decode($object, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($item)) {
                $out[] = $item;
            }
        }

        return $out;
    }

    /**
     * @param array<string, string> $known lowercased name => canonical name
     */
    protected function toToolCall(array $candidate, array $known, int $index, string $namespace): ?AiToolCall
    {
        // Unwrap the OpenAI-ish `{"function": {"name": ..., "arguments": ...}}`
        // envelope before looking for a name.
        if (isset($candidate['function']) && is_array($candidate['function'])) {
            $candidate = $candidate['function'] + $candidate;
        }

        $name = null;
        foreach (self::NAME_KEYS as $key) {
            if (isset($candidate[$key]) && is_string($candidate[$key]) && trim($candidate[$key]) !== '') {
                $name = trim($candidate[$key]);
                break;
            }
        }

        if ($name === null) {
            return null;
        }

        // Only accept names that were actually offered this turn. This is what
        // keeps the salvager from inventing capabilities out of prose.
        $canonical = $known[strtolower($name)] ?? null;
        if ($canonical === null) {
            return null;
        }

        $arguments = [];
        foreach (self::ARGUMENT_KEYS as $key) {
            if (!array_key_exists($key, $candidate)) {
                continue;
            }

            $raw = $candidate[$key];
            if (is_string($raw)) {
                $decoded = json_decode($raw, true);
                $arguments = is_array($decoded) ? $decoded : [];
            } elseif (is_array($raw)) {
                $arguments = $raw;
            }

            break;
        }

        return new AiToolCall(sprintf('salvaged_%s_%d', $namespace, $index), $canonical, $arguments);
    }

    /**
     * @param AiToolCall[] $calls
     */
    protected function alreadySeen(array $calls, AiToolCall $call): bool
    {
        foreach ($calls as $existing) {
            if ($existing->name === $call->name && $existing->arguments == $call->arguments) {
                return true;
            }
        }

        return false;
    }

    /**
     * A JSON Schema that constrains a repair attempt to a single valid call.
     *
     * Passed to Ollama as `format` (a real grammar, not a hint), which makes
     * schema-valid output the only thing the sampler can produce.
     *
     * @param AiTool[] $tools
     */
    public function repairSchema(array $tools): array
    {
        $names = array_values(array_map(fn (AiTool $t) => $t->name, $tools));

        return [
            'type' => 'object',
            'properties' => [
                'name' => [
                    'type' => 'string',
                    'enum' => $names,
                    'description' => 'The tool to call.',
                ],
                'arguments' => [
                    'type' => 'object',
                    'description' => 'Arguments for the tool, matching its schema.',
                ],
            ],
            'required' => ['name', 'arguments'],
        ];
    }
}
