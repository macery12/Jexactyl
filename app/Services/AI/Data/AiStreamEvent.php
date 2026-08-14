<?php

namespace Everest\Services\AI\Data;

/**
 * A single event yielded by a streaming driver.
 *
 * Drivers emit TEXT deltas as they arrive, TOOL_CALL_START as soon as a call's
 * name is known (so the UI can say "reading server.properties…" while the
 * arguments are still streaming in), and a fully assembled TOOL_CALL once its
 * argument JSON is complete.
 *
 * Reasoning arrives on its own channel rather than mixed into TEXT, because the
 * two are shown differently and only one of them is the answer. It comes in two
 * forms: REASONING carries human-readable deltas for display, REASONING_BLOCK
 * the provider's own opaque representation of a finished block, which some APIs
 * require echoed back verbatim on the next request.
 */
class AiStreamEvent
{
    public const TYPE_TEXT = 'text';
    public const TYPE_REASONING = 'reasoning';
    public const TYPE_REASONING_BLOCK = 'reasoning_block';
    public const TYPE_TOOL_CALL_START = 'tool_call_start';
    public const TYPE_TOOL_CALL = 'tool_call';
    public const TYPE_USAGE = 'usage';
    public const TYPE_DONE = 'done';
    public const TYPE_ERROR = 'error';

    /**
     * @param string|null $text a delta on whichever channel `$type` names —
     *                          the answer for TEXT, the model's reasoning for
     *                          REASONING
     * @param array $reasoningBlock provider-native and deliberately opaque; the
     *                              agent stores it and hands it straight back
     */
    private function __construct(
        public readonly string $type,
        public readonly ?string $text = null,
        public readonly ?AiToolCall $toolCall = null,
        public readonly ?string $toolName = null,
        public readonly array $usage = [],
        public readonly ?string $finishReason = null,
        public readonly ?string $error = null,
        public readonly array $reasoningBlock = [],
    ) {
    }

    public static function text(string $delta): self
    {
        return new self(self::TYPE_TEXT, text: $delta);
    }

    public static function reasoning(string $delta): self
    {
        return new self(self::TYPE_REASONING, text: $delta);
    }

    /**
     * A finished reasoning block, in whatever shape its provider requires back.
     */
    public static function reasoningBlock(array $block): self
    {
        return new self(self::TYPE_REASONING_BLOCK, reasoningBlock: $block);
    }

    public static function toolCallStart(string $id, string $name): self
    {
        return new self(self::TYPE_TOOL_CALL_START, toolName: $name, toolCall: new AiToolCall($id, $name));
    }

    public static function toolCall(AiToolCall $call): self
    {
        return new self(self::TYPE_TOOL_CALL, toolCall: $call, toolName: $call->name);
    }

    public static function usage(array $usage): self
    {
        return new self(self::TYPE_USAGE, usage: $usage);
    }

    public static function done(string $finishReason = AiResponse::FINISH_STOP): self
    {
        return new self(self::TYPE_DONE, finishReason: $finishReason);
    }

    public static function error(string $message): self
    {
        return new self(self::TYPE_ERROR, error: $message);
    }
}
