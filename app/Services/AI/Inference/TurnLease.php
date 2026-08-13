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
    ) {
    }

    public static function held(int $slot, Lock $lock, \Closure $onRelease): self
    {
        return new self($slot, false, $lock, $onRelease);
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
