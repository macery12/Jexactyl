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
    public const TYPE_REASONING = 'reasoning';
    public const TYPE_TOOL_PENDING = 'tool_pending';
    public const TYPE_TOOL_CALL = 'tool_call';
    public const TYPE_TOOL_RESULT = 'tool_result';
    public const TYPE_APPROVAL_REQUIRED = 'approval_required';
    public const TYPE_QUESTION_REQUIRED = 'question_required';
    public const TYPE_REDACTION = 'redaction';
    public const TYPE_ASSIST = 'assist';
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

    /**
     * The turn is waiting for an inference slot, and holds a place in line.
     *
     * The ticket is the place, and the client presents it on the next attempt
     * to keep it. This is the whole of the queueing contract: the panel does
     * not hold the turn open while it waits — that cost a PHP worker per waiter
     * — so a queued turn is one the client is responsible for coming back for.
     *
     * @param string|null $ticket null on a turn that was admitted immediately,
     *                            where the frame is informational only
     */
    public static function queued(
        int $position,
        int $ahead,
        int $etaSeconds,
        ?string $ticket = null,
        int $retryAfterMs = 0,
    ): self {
        return new self(self::TYPE_QUEUED, array_filter([
            'position' => $position,
            'ahead' => $ahead,
            'eta_seconds' => $etaSeconds,
            'ticket' => $ticket,
            'retry_after_ms' => $retryAfterMs ?: null,
        ], fn ($value) => $value !== null));
    }

    public static function text(string $delta): self
    {
        // `content` mirrors the pre-agent stream shape so a client that only
        // understands text still renders the answer.
        return new self(self::TYPE_TEXT, ['content' => $delta]);
    }

    /**
     * The model's own reasoning, on its own channel.
     *
     * Kept apart from TYPE_TEXT rather than folded into it because only one of
     * the two is the answer: reasoning is working-out, shown collapsed and never
     * replayed as part of the transcript.
     */
    public static function reasoning(string $delta): self
    {
        return new self(self::TYPE_REASONING, ['content' => $delta]);
    }

    /**
     * A tool call the model has named but not finished writing.
     *
     * Arguments stream after the name, and on a slow model that gap is seconds
     * of apparently nothing happening. This fills it: the row appears saying
     * what is about to run, and TYPE_TOOL_CALL fills in the detail.
     */
    public static function toolPending(string $id, string $tool): self
    {
        return new self(self::TYPE_TOOL_PENDING, ['id' => $id, 'tool' => $tool]);
    }

    public static function toolCall(
        string $id,
        string $tool,
        array $arguments,
        string $risk,
        ?string $batchParentId = null,
        ?int $batchIndex = null,
    ): self {
        return new self(self::TYPE_TOOL_CALL, array_filter([
            'id' => $id,
            'tool' => $tool,
            'arguments' => $arguments,
            'risk' => $risk,
            'batch_parent_id' => $batchParentId,
            'batch_index' => $batchIndex,
        ], fn ($value) => $value !== null));
    }

    /**
     * @param mixed $result the shaped payload the model was handed, echoed to the
     *                      client so a user can check the assistant's account of
     *                      it against the thing itself. Live only — the stored
     *                      transcript keeps the summary alone.
     */
    public static function toolResult(
        string $id,
        string $tool,
        bool $ok,
        string $summary,
        mixed $result = null,
        ?int $durationMs = null,
        ?string $outcome = null,
        ?string $batchParentId = null,
        ?int $batchIndex = null,
    ): self {
        return new self(self::TYPE_TOOL_RESULT, array_filter([
            'id' => $id,
            'tool' => $tool,
            'ok' => $ok,
            'summary' => $summary,
            'result' => $result,
            'duration_ms' => $durationMs,
            'outcome' => $outcome,
            'batch_parent_id' => $batchParentId,
            'batch_index' => $batchIndex,
        ], fn ($v) => $v !== null));
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

    /**
     * The turn has suspended to put a question to the user.
     *
     * Structurally the same suspension as an approval — the turn is persisted
     * and the stream closes — but it carries no risk tier, because nothing is
     * waiting to be run. The answer arrives on the same decide endpoint.
     *
     * @param array<int, array{label: string, description?: string}> $options
     */
    public static function questionRequired(
        string $turnId,
        string $question,
        array $options,
        bool $allowOther = false,
    ): self {
        return new self(self::TYPE_QUESTION_REQUIRED, [
            'turn_id' => $turnId,
            'question' => $question,
            'options' => $options,
            'allow_other' => $allowOther,
        ]);
    }

    /**
     * Personal data that was kept out of the request, and what it really was.
     *
     * This runs the opposite way to every other event here: the model got the
     * token and the browser gets the value. That is the whole design — the point
     * of redaction is that the inference provider never sees a customer's
     * address, not that the administrator is kept from seeing it. They can read
     * it in the user table already, and a transcript full of `[email_1]` with no
     * way to resolve it would just get the feature switched off.
     *
     * Sent as a delta of what is newly minted, so a long turn does not repeat
     * the whole map on every tool result.
     *
     * @param array<string, string> $values token => original
     */
    public static function redaction(array $values): self
    {
        return new self(self::TYPE_REDACTION, ['values' => $values]);
    }

    /**
     * An audited assist session has opened, or widened, on a customer's server.
     *
     * Emitted so the transcript can carry a standing banner naming the server:
     * the difference between reading the panel's records and reading somebody's
     * files should never be something an administrator has to infer from which
     * tools happen to be running.
     */
    public static function assist(string $serverUuid, string $serverName, bool $writable, string $reason): self
    {
        return new self(self::TYPE_ASSIST, [
            'server_uuid' => $serverUuid,
            'server_name' => $serverName,
            'writable' => $writable,
            'reason' => $reason,
        ]);
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
