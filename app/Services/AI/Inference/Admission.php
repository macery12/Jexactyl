<?php

namespace Everest\Services\AI\Inference;

/**
 * The answer to "may this turn run now?".
 *
 * Two shapes, and the caller must handle both: it either holds a slot and can
 * start, or it holds a place in the queue and must come back. There is
 * deliberately no third shape where the caller waits — that was the old
 * behaviour, and waiting meant a PHP worker asleep on a poll loop for up to two
 * minutes while a GPU it could not use finished somebody else's turn. Under
 * contention the queue was consuming the very workers it existed to protect.
 *
 * A ticket is the queue place made portable. The client presents it on the next
 * attempt and keeps its position; presenting nothing joins at the back.
 */
final class Admission
{
    private function __construct(
        public readonly ?TurnLease $lease,
        public readonly ?string $ticket,
        public readonly int $position,
        public readonly int $ahead,
        public readonly int $etaSeconds,
        public readonly int $retryAfterMs,
    ) {
    }

    public static function hold(TurnLease $lease): self
    {
        return new self($lease, null, 0, 0, 0, 0);
    }

    public static function wait(string $ticket, int $ahead, int $etaSeconds, int $retryAfterMs): self
    {
        return new self(null, $ticket, $ahead + 1, $ahead, $etaSeconds, $retryAfterMs);
    }

    public function granted(): bool
    {
        return $this->lease !== null;
    }

    /**
     * The queue place as the client is told about it.
     *
     * @return array{position: int, ahead: int, eta_seconds: int, ticket: string, retry_after_ms: int}
     */
    public function toArray(): array
    {
        return [
            'position' => $this->position,
            'ahead' => $this->ahead,
            'eta_seconds' => $this->etaSeconds,
            'ticket' => (string) $this->ticket,
            'retry_after_ms' => $this->retryAfterMs,
        ];
    }
}
