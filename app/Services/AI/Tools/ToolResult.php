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
     *
     * This is the *only* description of an outcome the user ever sees — neither
     * the live stream nor the stored transcript carries the shaped result — so
     * it is worth reading the data for something more useful than "done".
     */
    public function summary(): string
    {
        if (!$this->ok) {
            return sprintf('%s: %s', $this->code ?? 'error', $this->detail ?? 'Unknown error');
        }

        if (!is_array($this->data)) {
            return $this->truncated ? 'Read (truncated)' : 'Done';
        }

        // A batch reports its tally rather than its shape. It is the one result
        // whose row stands for many actions, and "Done" over a batch that half
        // ran is the most misleading thing this method could say.
        if (!empty($this->data['batch'])) {
            $succeeded = (int) ($this->data['succeeded'] ?? 0);
            $total = $succeeded + (int) ($this->data['failed'] ?? 0) + (int) ($this->data['not_run'] ?? 0);

            return $succeeded === $total
                ? sprintf('%d of %d done', $succeeded, $total)
                : sprintf('%d of %d done, %d failed', $succeeded, $total, (int) ($this->data['failed'] ?? 0));
        }

        // Anything built by the list shaper reports how much it found, which is
        // the one fact a collapsed row can usefully show.
        if (isset($this->data['count']) && is_numeric($this->data['count'])) {
            $count = (int) $this->data['count'];
            $shown = is_array($this->data['items'] ?? null) ? count($this->data['items']) : $count;

            $summary = $count === 1 ? '1 item' : sprintf('%d items', $count);

            return $shown < $count ? sprintf('%s (showing %d)', $summary, $shown) : $summary;
        }

        // Write-shaped results carry their own evidence.
        if (isset($this->data['additions']) || isset($this->data['deletions'])) {
            return sprintf('+%d / -%d lines', (int) ($this->data['additions'] ?? 0), (int) ($this->data['deletions'] ?? 0));
        }

        foreach (['written' => 'Written', 'created' => 'Created', 'deleted' => 'Deleted', 'renamed' => 'Renamed', 'copied' => 'Copied', 'sent' => 'Sent', 'extracted' => 'Extracted', 'restore_started' => 'Restore started'] as $flag => $label) {
            if (!empty($this->data[$flag])) {
                return $label;
            }
        }

        return $this->truncated ? 'Read (truncated)' : 'Done';
    }
}
