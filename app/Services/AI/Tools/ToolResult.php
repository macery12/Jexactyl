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
    public const OUTCOME_SUCCESS = 'success';
    public const OUTCOME_PARTIAL = 'partial';
    public const OUTCOME_FAILED = 'failed';

    private function __construct(
        public readonly bool $ok,
        public readonly mixed $data = null,
        public readonly ?string $code = null,
        public readonly ?string $detail = null,
        public readonly ?int $status = null,
        public readonly bool $retryable = false,
        public readonly ?array $fields = null,
        public readonly bool $truncated = false,
        public readonly string $outcome = self::OUTCOME_SUCCESS,
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
        return new self(false, null, $code, $detail, $status, $retryable, $fields, outcome: self::OUTCOME_FAILED);
    }

    /**
     * Build the truthful outer result for a batch while retaining its child
     * ledger. `ok` means every child ran successfully; a partial result is not
     * silently promoted merely because at least one child worked.
     */
    public static function batch(array $data): self
    {
        $succeeded = (int) ($data['succeeded'] ?? 0);
        $failed = (int) ($data['failed'] ?? 0);
        $notRun = (int) ($data['not_run'] ?? 0);

        $outcome = $failed === 0 && $notRun === 0 && $succeeded > 0
            ? self::OUTCOME_SUCCESS
            : ($succeeded > 0 ? self::OUTCOME_PARTIAL : self::OUTCOME_FAILED);

        return new self(
            $outcome === self::OUTCOME_SUCCESS,
            $data,
            $outcome === self::OUTCOME_SUCCESS ? null : 'batch_' . $outcome,
            outcome: $outcome,
        );
    }

    /**
     * A failure that is ours, not the model's. Deliberately terse: internal
     * detail must never reach the model context or the user's screen.
     */
    public static function internalError(string $detail): self
    {
        return new self(false, null, 'internal_error', $detail, outcome: self::OUTCOME_FAILED);
    }

    /**
     * The JSON the model is shown. Keys are short because every one of them is
     * paid for in tokens on each subsequent step of the turn.
     */
    public function toModelPayload(): string
    {
        if ($this->isBatch()) {
            $payload = [
                'ok' => $this->ok,
                'status' => $this->outcome,
                'result' => $this->data,
            ];

            if (!$this->ok) {
                $payload['error'] = $this->code;
            }
        } elseif ($this->ok) {
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

        return json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        ) ?: '{"ok":false,"error":"encoding_failed"}';
    }

    /**
     * Cap the final, shaped and redacted model payload by encoded bytes.
     *
     * The value stays structured: lists retain a representative prefix and
     * objects retain their keys. Reducing the decoded value before encoding is
     * what keeps the JSON valid, while `mb_strcut()` prevents a byte boundary
     * from splitting a UTF-8 code point.
     */
    public function capped(int $maxBytes): self
    {
        if (strlen($this->toModelPayload()) <= $maxBytes) {
            return $this;
        }

        $data = $this->data;
        $candidate = $this->withData($data, true);

        while (strlen($candidate->toModelPayload()) > $maxBytes && self::reduce($data)) {
            $candidate = $this->withData($data, true);
        }

        if (strlen($candidate->toModelPayload()) <= $maxBytes) {
            return $candidate;
        }

        // Configuration validation floors this at 1 KiB. This last envelope is
        // nevertheless useful for direct callers with an unusually tiny cap.
        $candidate = $this->withData(['omitted' => true], true);

        return strlen($candidate->toModelPayload()) <= $maxBytes
            ? $candidate
            : ToolResult::error('result_too_large', 'The tool result exceeded the configured byte limit.');
    }

    public function isBatch(): bool
    {
        return is_array($this->data) && !empty($this->data['batch']);
    }

    protected function withData(mixed $data, bool $truncated): self
    {
        return new self(
            $this->ok,
            $data,
            $this->code,
            $this->detail,
            $this->status,
            $this->retryable,
            $this->fields,
            $truncated,
            $this->outcome,
        );
    }

    /** Preserve outcome/error metadata while replacing structured result data. */
    public function replaceData(mixed $data): self
    {
        return $this->withData($data, $this->truncated);
    }

    /** Reduce the largest useful part of a value, keeping its JSON shape. */
    protected static function reduce(mixed &$value): bool
    {
        if (is_string($value)) {
            $bytes = strlen($value);
            if ($bytes === 0) {
                return false;
            }

            $value = mb_strcut($value, 0, intdiv($bytes, 2), 'UTF-8');

            return true;
        }

        if (!is_array($value) || $value === []) {
            return false;
        }

        if (array_is_list($value) && count($value) > 1) {
            $value = array_slice($value, 0, (int) ceil(count($value) / 2));

            return true;
        }

        $largestKey = null;
        $largestBytes = -1;
        foreach ($value as $key => $child) {
            if (!self::reducible($child)) {
                continue;
            }

            $encoded = json_encode($child, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
            $bytes = $encoded === false ? 0 : strlen($encoded);
            if ($bytes > $largestBytes) {
                $largestBytes = $bytes;
                $largestKey = $key;
            }
        }

        return $largestKey !== null && self::reduce($value[$largestKey]);
    }

    protected static function reducible(mixed $value): bool
    {
        if (is_string($value)) {
            return $value !== '';
        }

        if (!is_array($value) || $value === []) {
            return false;
        }

        if (array_is_list($value) && count($value) > 1) {
            return true;
        }

        foreach ($value as $child) {
            if (self::reducible($child)) {
                return true;
            }
        }

        return false;
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
        if ($this->isBatch()) {
            $succeeded = (int) ($this->data['succeeded'] ?? 0);
            $failed = (int) ($this->data['failed'] ?? 0);
            $notRun = (int) ($this->data['not_run'] ?? 0);
            $total = $succeeded + $failed + $notRun;

            if ($this->outcome === self::OUTCOME_SUCCESS) {
                return sprintf('%d of %d done', $succeeded, $total);
            }

            return sprintf(
                '%d of %d done; %d failed, %d not run',
                $succeeded,
                $total,
                $failed,
                $notRun,
            );
        }

        if (!$this->ok) {
            return sprintf('%s: %s', $this->code ?? 'error', $this->detail ?? 'Unknown error');
        }

        if (!is_array($this->data)) {
            return $this->truncated ? 'Read (truncated)' : 'Done';
        }

        // Anything built by the list shaper reports how much it found, which is
        // the one fact a collapsed row can usefully show. When the endpoint
        // paginated, the number worth showing is how many records exist rather
        // than how many happened to fit on one page.
        if (isset($this->data['count']) && is_numeric($this->data['count'])) {
            $count = (int) $this->data['count'];
            $shown = is_array($this->data['items'] ?? null) ? count($this->data['items']) : $count;
            $total = is_numeric($this->data['pagination']['total'] ?? null)
                ? (int) $this->data['pagination']['total']
                : $count;

            $summary = $total === 1 ? '1 item' : sprintf('%d items', $total);

            return $shown < $total ? sprintf('%s (showing %d)', $summary, $shown) : $summary;
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
