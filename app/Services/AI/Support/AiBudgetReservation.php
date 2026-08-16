<?php

namespace Everest\Services\AI\Support;

/**
 * Ownership token for one budget admission.
 *
 * Release is idempotent and token-qualified, so a delayed cleanup from an
 * expired worker cannot remove the replacement reservation.
 */
class AiBudgetReservation
{
    private bool $released = false;

    private function __construct(
        public readonly bool $passthrough,
        private ?\Closure $onRelease = null,
    ) {
    }

    public static function held(\Closure $onRelease): self
    {
        return new self(false, $onRelease);
    }

    public static function passthrough(): self
    {
        return new self(true);
    }

    public function release(): void
    {
        if ($this->released) {
            return;
        }

        $this->released = true;
        if ($this->onRelease !== null) {
            ($this->onRelease)();
        }
    }
}
