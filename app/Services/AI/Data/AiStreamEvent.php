<?php

namespace Everest\Services\AI\Data;

/**
 * A single event yielded by a streaming driver.
 *
 * Drivers emit TEXT deltas as they arrive, TOOL_CALL_START as soon as a call's
 * name is known (so the UI can say "reading server.properties…" while the
 * arguments are still streaming in), and a fully assembled TOOL_CALL once its
 * argument JSON is complete.
 */
class AiStreamEvent
{
    public const TYPE_TEXT = 'text';
    public const TYPE_TOOL_CALL_START = 'tool_call_start';
    public const TYPE_TOOL_CALL = 'tool_call';
    public const TYPE_USAGE = 'usage';
    public const TYPE_DONE = 'done';
    public const TYPE_ERROR = 'error';

    private function __construct(
        public readonly string $type,
        public readonly ?string $text = null,
        public readonly ?AiToolCall $toolCall = null,
        public readonly ?string $toolName = null,
        public readonly array $usage = [],
        public readonly ?string $finishReason = null,
        public readonly ?string $error = null,
    ) {
    }

    public static function text(string $delta): self
    {
        return new self(self::TYPE_TEXT, text: $delta);
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
