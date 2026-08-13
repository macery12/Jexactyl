<?php

namespace Everest\Services\AI\Inference;

use Everest\Models\Setting;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Exceptions\Service\AI\AIServiceException;

/**
 * Admission control for self-hosted inference.
 *
 * A GPU serves a fixed number of concurrent requests. Past that point, adding
 * load does not add throughput — it slows every request in flight, which is
 * far worse for twenty users than making nineteen of them wait briefly. This
 * gate bounds concurrency and queues the overflow.
 *
 * It replaces the single global stream lock the AI module used to hold, which
 * serialised *all* users onto one request at a time. That was survivable when
 * a turn was one call; an agent turn is five to fifteen, so it would have
 * turned any concurrency at all into a stall.
 *
 * Design notes:
 *
 * - **Slot-per-lock, not a ticket queue.** Strict FIFO needs a "now serving"
 *   counter, which desynchronises the moment a waiter times out and abandons
 *   its ticket. Polling a fixed set of slot locks is self-healing and, because
 *   every waiter polls on the same interval, is near-FIFO in practice.
 * - **Two lanes.** A turn resuming after a human approved an action jumps
 *   ahead of brand-new turns: it is already half-finished, the user is
 *   actively waiting on it, and finishing it is what returns VRAM to the pool.
 *   New turns stand down while any resume is waiting.
 * - **The lease is turn-scoped.** A turn acquires once and holds through every
 *   model call and tool execution, rather than re-queueing per step — which
 *   would make a ten-step turn queue ten times.
 */
class InferenceGate
{
    /**
     * A turn coming back after a human approved a pending action.
     */
    public const LANE_RESUME = 'resume';

    /**
     * A turn starting from a fresh user message.
     */
    public const LANE_NEW = 'new';

    protected const SLOT_KEY = 'ai:slot:';
    protected const WAITING_KEY = 'ai:waiting:';
    protected const USER_KEY = 'ai:active:user:';
    protected const EWMA_KEY = 'ai:ewma_ms';

    /**
     * How often a waiter re-checks for a free slot.
     */
    protected const POLL_INTERVAL_US = 250_000;

    /**
     * Smoothing factor for the rolling turn-duration average behind the ETA.
     */
    protected const EWMA_ALPHA = 0.3;

    /**
     * Fallback per-turn estimate before any turn has completed, in ms.
     */
    protected const DEFAULT_TURN_MS = 20_000;

    public function __construct(private ProviderFactory $factory)
    {
    }

    /**
     * Acquire a slot for one turn.
     *
     * @param string $ownerKey identity for per-user fairness (typically the user uuid)
     * @param callable|null $onWait invoked with (position, ahead, etaSeconds) while queued,
     *                              so a streaming caller can report progress to the user
     *
     * @throws AIServiceException when the queue is full or the wait is exceeded
     */
    public function acquire(string $ownerKey, string $lane = self::LANE_NEW, ?callable $onWait = null): TurnLease
    {
        if (!$this->applies()) {
            return TurnLease::passthrough();
        }

        $this->assertUserHasCapacity($ownerKey);

        // Fast path: a free slot with nobody queued ahead.
        if (!$this->shouldStandDown($lane) && ($lease = $this->tryGrabSlot($ownerKey)) !== null) {
            return $lease;
        }

        return $this->waitForSlot($ownerKey, $lane, $onWait);
    }

    /**
     * Whether admission control applies to the configured provider. Hosted
     * providers are bounded by budgets, not hardware, so they skip it.
     */
    public function applies(): bool
    {
        return in_array($this->factory->provider(), ProviderConfig::SELF_HOSTED, true);
    }

    /**
     * @throws AIServiceException
     */
    protected function waitForSlot(string $ownerKey, string $lane, ?callable $onWait): TurnLease
    {
        $depth = $this->queueDepth();
        if ($depth >= $this->maxQueueDepth()) {
            // Refuse fast rather than growing a queue nobody reaches the front
            // of. The caller must not charge a token budget for this.
            throw new AIServiceException('The AI is at capacity right now and the queue is full. Please try again in a minute.');
        }

        $this->enterQueue($lane);
        $deadline = microtime(true) + $this->maxWaitSeconds();
        $reported = null;

        try {
            while (true) {
                if (!$this->shouldStandDown($lane)) {
                    $lease = $this->tryGrabSlot($ownerKey);
                    if ($lease !== null) {
                        return $lease;
                    }
                }

                if (microtime(true) >= $deadline) {
                    throw new AIServiceException('The AI is busy and did not free up in time. Please try again in a moment.');
                }

                if ($onWait !== null) {
                    $ahead = $this->aheadOf($lane);
                    // Only re-report when the number actually moves, so a
                    // streaming caller does not spam identical frames.
                    if ($ahead !== $reported) {
                        $reported = $ahead;
                        $onWait($ahead + 1, $ahead, $this->estimatedWaitSeconds($ahead));
                    }
                }

                usleep(self::POLL_INTERVAL_US);
            }
        } finally {
            $this->leaveQueue($lane);
        }
    }

    /**
     * Try each slot once. The first uncontended lock wins.
     */
    protected function tryGrabSlot(string $ownerKey): ?TurnLease
    {
        $ttl = $this->leaseTtlSeconds();

        for ($slot = 0; $slot < $this->slots(); ++$slot) {
            $lock = Cache::lock(self::SLOT_KEY . $slot, $ttl);

            if ($lock->get()) {
                $this->incrementUser($ownerKey);

                return TurnLease::held($slot, $lock, function () use ($ownerKey) {
                    $this->decrementUser($ownerKey);
                });
            }
        }

        return null;
    }

    /**
     * Whether a lane must yield. New turns stand down while any resume is
     * queued, so half-finished work drains first and releases its VRAM.
     */
    protected function shouldStandDown(string $lane): bool
    {
        return $lane === self::LANE_NEW && $this->waiting(self::LANE_RESUME) > 0;
    }

    /**
     * How many waiters sit in front of this one.
     */
    protected function aheadOf(string $lane): int
    {
        if ($lane === self::LANE_RESUME) {
            return max(0, $this->waiting(self::LANE_RESUME) - 1);
        }

        return max(0, $this->waiting(self::LANE_NEW) - 1) + $this->waiting(self::LANE_RESUME);
    }

    /*
    |--------------------------------------------------------------------------
    | Per-user fairness
    |--------------------------------------------------------------------------
    */

    /**
     * @throws AIServiceException
     */
    protected function assertUserHasCapacity(string $ownerKey): void
    {
        $limit = $this->perUserLimit();

        if ($limit > 0 && $this->activeForUser($ownerKey) >= $limit) {
            throw new AIServiceException('You already have an AI request running. Wait for it to finish before starting another.');
        }
    }

    public function activeForUser(string $ownerKey): int
    {
        return max(0, (int) Cache::get(self::USER_KEY . $ownerKey, 0));
    }

    protected function incrementUser(string $ownerKey): void
    {
        $key = self::USER_KEY . $ownerKey;

        // Seeded with a TTL so an abandoned counter cannot lock a user out
        // permanently — it expires on the same horizon as the slot lock.
        if (Cache::add($key, 1, $this->leaseTtlSeconds())) {
            return;
        }

        Cache::increment($key);
    }

    protected function decrementUser(string $ownerKey): void
    {
        $key = self::USER_KEY . $ownerKey;

        if (Cache::decrement($key) <= 0) {
            Cache::forget($key);
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Queue bookkeeping
    |--------------------------------------------------------------------------
    */

    protected function enterQueue(string $lane): void
    {
        $key = self::WAITING_KEY . $lane;

        if (!Cache::add($key, 1, $this->maxWaitSeconds() + 60)) {
            Cache::increment($key);
        }
    }

    protected function leaveQueue(string $lane): void
    {
        $key = self::WAITING_KEY . $lane;

        if (Cache::decrement($key) <= 0) {
            Cache::forget($key);
        }
    }

    public function waiting(string $lane): int
    {
        return max(0, (int) Cache::get(self::WAITING_KEY . $lane, 0));
    }

    public function queueDepth(): int
    {
        return $this->waiting(self::LANE_NEW) + $this->waiting(self::LANE_RESUME);
    }

    /**
     * How many slots are currently held. Derived by probing rather than
     * counted, so it cannot drift away from reality.
     */
    public function slotsInUse(): int
    {
        $inUse = 0;

        for ($slot = 0; $slot < $this->slots(); ++$slot) {
            $lock = Cache::lock(self::SLOT_KEY . $slot, 1);

            if ($lock->get()) {
                $lock->release();
            } else {
                ++$inUse;
            }
        }

        return $inUse;
    }

    /*
    |--------------------------------------------------------------------------
    | Timing
    |--------------------------------------------------------------------------
    */

    /**
     * Feed a completed turn into the rolling average behind the queue ETA.
     */
    public function recordTurnDuration(int $milliseconds): void
    {
        if ($milliseconds <= 0) {
            return;
        }

        $previous = (int) Cache::get(self::EWMA_KEY, 0);
        $next = $previous > 0
            ? (int) round(self::EWMA_ALPHA * $milliseconds + (1 - self::EWMA_ALPHA) * $previous)
            : $milliseconds;

        Cache::put(self::EWMA_KEY, $next, 86400);
    }

    public function averageTurnMs(): int
    {
        return (int) Cache::get(self::EWMA_KEY, self::DEFAULT_TURN_MS);
    }

    /**
     * Rough seconds until a waiter with `$ahead` in front reaches a slot.
     * Whole queue positions clear in parallel across slots, hence the divide.
     */
    public function estimatedWaitSeconds(int $ahead): int
    {
        $slots = max(1, $this->slots());
        $batches = (int) floor($ahead / $slots) + 1;

        return max(1, (int) round(($batches * $this->averageTurnMs()) / 1000));
    }

    /**
     * A snapshot for the admin inference card.
     */
    public function stats(): array
    {
        if (!$this->applies()) {
            return [
                'applies' => false,
                'slots' => null,
                'slots_in_use' => null,
                'queue_depth' => 0,
                'average_turn_ms' => null,
                'resident_models' => [],
            ];
        }

        return [
            'applies' => true,
            'slots' => $this->slots(),
            'slots_in_use' => $this->slotsInUse(),
            'queue_depth' => $this->queueDepth(),
            'waiting_new' => $this->waiting(self::LANE_NEW),
            'waiting_resume' => $this->waiting(self::LANE_RESUME),
            'max_queue_depth' => $this->maxQueueDepth(),
            'average_turn_ms' => $this->averageTurnMs(),
            'resident_models' => $this->residentModels(),
        ];
    }

    /**
     * Models currently loaded on the inference host, with VRAM footprint.
     * Empty for providers with no notion of a resident model.
     */
    protected function residentModels(): array
    {
        try {
            $provider = $this->factory->make();
        } catch (\Throwable $e) {
            return [];
        }

        return $provider instanceof OllamaProvider ? $provider->runningModels() : [];
    }

    /*
    |--------------------------------------------------------------------------
    | Settings
    |--------------------------------------------------------------------------
    */

    /**
     * Concurrent slots. Defaults to two — the usual Ollama parallelism — when
     * the admin has not pinned a value.
     */
    public function slots(): int
    {
        $configured = $this->setting('concurrency:slots', config('modules.ai.concurrency.slots'));

        return max(1, (int) ($configured ?: 2));
    }

    public function maxQueueDepth(): int
    {
        return max(1, (int) $this->setting('concurrency:queue_depth', config('modules.ai.concurrency.queue_depth', 20)));
    }

    public function maxWaitSeconds(): int
    {
        return max(5, (int) $this->setting('concurrency:max_wait_seconds', config('modules.ai.concurrency.max_wait_seconds', 120)));
    }

    public function perUserLimit(): int
    {
        return (int) $this->setting('concurrency:per_user', config('modules.ai.concurrency.per_user', 1));
    }

    /**
     * How long a slot may be held before the lock self-expires. Sized off the
     * agent's own wall-clock cap plus a margin, because lock expiry is the
     * only thing that recovers a slot from a crashed worker.
     */
    protected function leaseTtlSeconds(): int
    {
        $wall = (int) $this->setting('agent:max_wall_seconds', config('modules.ai.agent.max_wall_seconds', 180));

        return max(60, $wall) + 60;
    }

    protected function setting(string $key, mixed $default = null): mixed
    {
        return Setting::get('settings::modules:ai:' . $key, $default);
    }
}
