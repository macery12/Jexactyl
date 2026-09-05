<?php

namespace Everest\Services\AI\Data;

/**
 * The assembled result of one inference call, whether it arrived in a single
 * body or was accumulated from a stream.
 */
class AiResponse
{
    public const FINISH_STOP = 'stop';
    public const FINISH_TOOL_CALLS = 'tool_calls';
    public const FINISH_LENGTH = 'length';
    public const FINISH_ERROR = 'error';

    /**
     * The provider's safety classifiers declined the request. Distinct from an
     * error: the call succeeded, there is simply no usable content, and
     * retrying the same prompt will not help.
     */
    public const FINISH_REFUSAL = 'refusal';

    /**
     * @param AiToolCall[] $toolCalls
     * @param array $usage token counts and optional provider-native timing metrics
     */
    public function __construct(
        public readonly ?string $content,
        public readonly array $toolCalls = [],
        public readonly string $finishReason = self::FINISH_STOP,
        public readonly array $usage = [],
        public readonly ?string $model = null,
        public readonly bool $cached = false,
    ) {
    }

    public function hasToolCalls(): bool
    {
        return $this->toolCalls !== [];
    }

    /**
     * Whether the model stopped because it ran out of output budget. Worth
     * surfacing distinctly: a truncated tool call is a config problem
     * (max_tokens too low), not a model failure.
     */
    public function wasTruncated(): bool
    {
        return $this->finishReason === self::FINISH_LENGTH;
    }

    public function toAssistantMessage(): AiMessage
    {
        return AiMessage::assistant($this->content, $this->toolCalls);
    }

    public function totalTokens(): int
    {
        return (int) ($this->usage['total_tokens']
            ?? (($this->usage['prompt_tokens'] ?? 0) + ($this->usage['completion_tokens'] ?? 0)));
    }
}
