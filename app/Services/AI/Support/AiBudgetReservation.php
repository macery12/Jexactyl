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
        private ?int $userId = null,
        private ?string $token = null,
    ) {
    }

    public static function held(\Closure $onRelease, ?int $userId = null, ?string $token = null): self
    {
        return new self(false, $onRelease, $userId, $token);
    }

    /**
     * A description of this reservation that survives leaving the process.
     *
     * A durable turn reserves budget in the request and releases it in a worker,
     * so the closure above cannot be the thing that travels. The token can:
     * release is already token-qualified, which is what stops a late cleanup
     * from an expired worker deleting the replacement reservation — the same
     * property that makes releasing from another process safe.
     *
     * Null for a passthrough reservation, which holds no row to delete.
     *
     * @return array{user_id: int, token: string}|null
     */
    public function handle(): ?array
    {
        if ($this->passthrough || $this->userId === null || $this->token === null) {
            return null;
        }

        return ['user_id' => $this->userId, 'token' => $this->token];
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
