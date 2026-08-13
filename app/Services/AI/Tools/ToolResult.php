<?php

namespace Everest\Services\AI\Tools;

/**
 * The outcome of one tool call, in the shape the model reads.
 *
 * Errors are first-class rather than exceptions: an agent that learns "that
 * path does not exist" can correct itself on the next step, whereas a thrown
 * exception would end the turn. What separates the two is `retryable` — a 422
 * means the model can fix its own arguments, a 403 means it should stop and
 * tell the user.
 */
class ToolResult
{
    private function __construct(
        public readonly bool $ok,
        public readonly mixed $data = null,
        public readonly ?string $code = null,
        public readonly ?string $detail = null,
        public readonly ?int $status = null,
        public readonly bool $retryable = false,
        public readonly ?array $fields = null,
        public readonly bool $truncated = false,
    ) {
    }

    public static function ok(mixed $data, bool $truncated = false): self
    {
        return new self(true, $data, truncated: $truncated);
    }

    public static function error(
        string $code,
        string $detail,
        ?int $status = null,
        bool $retryable = false,
        ?array $fields = null,
    ): self {
        return new self(false, null, $code, $detail, $status, $retryable, $fields);
    }

    /**
     * A failure that is ours, not the model's. Deliberately terse: internal
     * detail must never reach the model context or the user's screen.
     */
    public static function internalError(string $detail): self
    {
        return new self(false, null, 'internal_error', $detail);
    }

    /**
     * The JSON the model is shown. Keys are short because every one of them is
     * paid for in tokens on each subsequent step of the turn.
     */
    public function toModelPayload(): string
    {
        if ($this->ok) {
            $payload = ['ok' => true, 'result' => $this->data];

            if ($this->truncated) {
                $payload['truncated'] = true;
                $payload['note'] = 'Output was truncated. Request a narrower range to see more.';
            }
        } else {
            $payload = array_filter([
                'ok' => false,
                'error' => $this->code,
                'message' => $this->detail,
                'retryable' => $this->retryable,
                'fields' => $this->fields,
            ], fn ($v) => $v !== null);
        }

        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{"ok":false,"error":"encoding_failed"}';
    }

    /**
     * A one-line summary for the audit trail and the UI card.
     */
    public function summary(): string
    {
        if ($this->ok) {
            return 'Succeeded';
        }

        return sprintf('%s: %s', $this->code ?? 'error', $this->detail ?? 'Unknown error');
    }
}
