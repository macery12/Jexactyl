<?php

namespace Everest\Services\AI\Inference;

use Illuminate\Contracts\Cache\Lock;

/**
 * A held inference slot.
 *
 * Acquired once per turn and released in a `finally`. If the PHP worker dies
 * mid-turn the underlying lock simply expires, so a crash frees the slot
 * without any reaper process — that TTL is the whole recovery story, which is
 * why it is sized off the agent's wall-clock cap rather than a guess.
 */
class TurnLease
{
    private bool $released = false;

    private function __construct(
        public readonly ?int $slot,
        public readonly bool $passthrough,
        private ?Lock $lock = null,
        private ?\Closure $onRelease = null,
        /** @var array{ownerKey: string, token: string}|null */
        private ?array $reservation = null,
    ) {
    }

    /**
     * @param array{ownerKey: string, token: string} $reservation the per-user
     *                                                            fairness
     *                                                            reservation
     *                                                            this lease
     *                                                            also owns
     */
    public static function held(int $slot, Lock $lock, array $reservation, \Closure $onRelease): self
    {
        return new self($slot, false, $lock, $onRelease, $reservation);
    }

    /**
     * A description of this lease that survives leaving the process. A durable
     * turn is admitted by a request and released by a worker, which cannot share
     * a `Lock` object — but can share its name and owner token, exactly what
     * `Cache::restoreLock()` needs. The owner token keeps it honest: a lease
     * expired and retaken cannot be released out from under its new holder.
     *
     * Null for a passthrough lease, which owns nothing to hand over.
     *
     * @return array{slot: int, owner: string, reservation: array{ownerKey: string, token: string}}|null
     */
    public function handle(): ?array
    {
        if ($this->passthrough || $this->lock === null || $this->slot === null) {
            return null;
        }

        return [
            'slot' => $this->slot,
            'owner' => $this->lock->owner(),
            'reservation' => $this->reservation ?? ['ownerKey' => '', 'token' => ''],
        ];
    }

    /**
     * A lease for providers that need no admission control — hosted APIs,
     * where the binding constraint is spend rather than VRAM. Callers get the
     * same shape either way so the turn code has no branch.
     */
    public static function passthrough(): self
    {
        return new self(null, true);
    }

    public function release(): void
    {
        if ($this->released) {
            return;
        }

        $this->released = true;

        try {
            $this->lock?->release();
        } finally {
            if ($this->onRelease !== null) {
                ($this->onRelease)();
            }
        }
    }
}
