<?php

namespace Everest\Services\AI\Support;

use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;

/**
 * Cheap, provider-agnostic token estimation.
 *
 * Deliberately approximate. It exists to size Ollama's `num_ctx` and to guard
 * budgets before a call is made — both cases want a fast upper-ish bound, not
 * accuracy. Real usage numbers always come back from the provider afterwards.
 */
class TokenEstimator
{
    /**
     * Bytes per token. English prose averages ~4; JSON tool payloads and file
     * contents tokenise worse, so 3.5 keeps the estimate on the safe side.
     */
    public const BYTES_PER_TOKEN = 3.5;

    /**
     * Per-message framing overhead (role markers, delimiters).
     */
    public const MESSAGE_OVERHEAD = 8;

    public static function forText(?string $text): int
    {
        if ($text === null || $text === '') {
            return 0;
        }

        return (int) ceil(strlen($text) / self::BYTES_PER_TOKEN);
    }

    public static function forMessage(AiMessage $message): int
    {
        $tokens = self::forText($message->content) + self::MESSAGE_OVERHEAD;

        foreach ($message->toolCalls as $call) {
            $tokens += self::forText($call->name) + self::forText(json_encode($call->arguments));
        }

        return $tokens;
    }

    /**
     * @param AiTool[] $tools
     */
    public static function forTools(array $tools): int
    {
        $tokens = 0;
        foreach ($tools as $tool) {
            $tokens += self::forText($tool->name)
                + self::forText($tool->description)
                + self::forText(json_encode($tool->parameters));
        }

        return $tokens;
    }

    /**
     * Estimated input size of a request: system prompt + history + tool schemas.
     */
    public static function forRequest(AiRequest $request, string $systemPrompt = ''): int
    {
        $tokens = self::forText($systemPrompt ?: $request->systemPrompt);

        foreach ($request->messages as $message) {
            $tokens += self::forMessage($message);
        }

        return $tokens + self::forTools($request->tools);
    }
}
