<?php

namespace Everest\Services\AI\Agent;

/**
 * An event emitted while a turn runs.
 *
 * Serialised straight onto the SSE stream, so the wire vocabulary is defined
 * here rather than in the controller. The frontend reader switches on `type`;
 * the legacy `{content}` shape is preserved for plain text so an older client
 * still renders a readable answer.
 */
class AgentEvent
{
    public const TYPE_CONVERSATION = 'conversation';
    public const TYPE_QUEUED = 'queued';
    public const TYPE_TEXT = 'text';
    public const TYPE_TOOL_CALL = 'tool_call';
    public const TYPE_TOOL_RESULT = 'tool_result';
    public const TYPE_APPROVAL_REQUIRED = 'approval_required';
    public const TYPE_OPERATION = 'operation';
    public const TYPE_STEP = 'step';
    public const TYPE_DONE = 'done';
    public const TYPE_ERROR = 'error';

    private function __construct(
        public readonly string $type,
        public readonly array $payload = [],
    ) {
    }

    /**
     * The conversation this turn is being written to. Emitted first, because a
     * turn opens its own conversation when the client did not name one and the
     * client needs the id to select it in the history rail.
     */
    public static function conversation(int $id, string $title): self
    {
        return new self(self::TYPE_CONVERSATION, ['id' => $id, 'title' => $title]);
    }

    public static function queued(int $position, int $ahead, int $etaSeconds): self
    {
        return new self(self::TYPE_QUEUED, [
            'position' => $position,
            'ahead' => $ahead,
            'eta_seconds' => $etaSeconds,
        ]);
    }

    public static function text(string $delta): self
    {
        // `content` mirrors the pre-agent stream shape so a client that only
        // understands text still renders the answer.
        return new self(self::TYPE_TEXT, ['content' => $delta]);
    }

    public static function toolCall(string $id, string $tool, array $arguments, string $risk): self
    {
        return new self(self::TYPE_TOOL_CALL, [
            'id' => $id,
            'tool' => $tool,
            'arguments' => $arguments,
            'risk' => $risk,
        ]);
    }

    public static function toolResult(string $id, string $tool, bool $ok, string $summary): self
    {
        return new self(self::TYPE_TOOL_RESULT, [
            'id' => $id,
            'tool' => $tool,
            'ok' => $ok,
            'summary' => $summary,
        ]);
    }

    /**
     * The turn has suspended and will not continue until the user decides.
     */
    public static function approvalRequired(
        string $turnId,
        string $tool,
        array $arguments,
        string $risk,
        ?array $preview = null,
    ): self {
        return new self(self::TYPE_APPROVAL_REQUIRED, array_filter([
            'turn_id' => $turnId,
            'tool' => $tool,
            'arguments' => $arguments,
            'risk' => $risk,
            'preview' => $preview,
        ], fn ($v) => $v !== null));
    }

    public static function operation(string $uuid, string $kind, string $status): self
    {
        return new self(self::TYPE_OPERATION, [
            'uuid' => $uuid,
            'kind' => $kind,
            'status' => $status,
        ]);
    }

    public static function step(int $step, int $maxSteps): self
    {
        return new self(self::TYPE_STEP, ['step' => $step, 'max_steps' => $maxSteps]);
    }

    public static function done(string $reason = 'complete'): self
    {
        return new self(self::TYPE_DONE, ['reason' => $reason]);
    }

    public static function error(string $message, bool $retryable = false): self
    {
        return new self(self::TYPE_ERROR, ['error' => $message, 'retryable' => $retryable]);
    }

    public function toArray(): array
    {
        return ['type' => $this->type] + $this->payload;
    }
}
