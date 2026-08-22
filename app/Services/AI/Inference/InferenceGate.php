<?php

namespace Everest\Services\AI\Inference;

use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Exceptions\Service\AI\AIServiceException;

/**
 * Admission control for self-hosted inference: bounds concurrency against a
 * GPU's fixed capacity and queues the overflow.
 *
 * - Nobody waits in a worker. A turn with no slot gets a ticket and the request
 *   ends, so queueing costs no PHP worker.
 * - The ticket is the place in line. Presenting it again keeps the position;
 *   dropping it frees the place and the per-user reservation, with no reaper.
 * - Slots are locks, not queue entries. The queue decides who may try; taking
 *   the lock decides if one is free, so a crashed worker's slot returns on
 *   lock expiry.
 * - Resumes outrank new turns — they are half-finished and hold VRAM.
 * - The lease is turn-scoped: admitted once, held across every model call and
 *   tool execution rather than re-queued per step.
 *
 * @phpstan-type Ticket array{
 *     token: string,
 *     owner: string,
 *     lane: string,
 *     seq: int,
 *     issued: float,
 *     seen: float,
 *     reservation: array{ownerKey: string, token: string},
 * }
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
    protected const QUEUE_KEY = 'ai:queue';
    protected const USER_KEY = 'ai:active:user:';
    protected const USER_RESERVATION_KEY = 'ai:reservation:user:';
    protected const ADMISSION_LOCK_KEY = 'ai:admission';
    protected const USER_LOCK_KEY = 'ai:admission:user:';
    protected const EWMA_KEY = 'ai:ewma_ms';

    /**
     * How long a ticket survives without being presented again. Generous
     * against the retry interval — several missed attempts, not one — since
     * dropping a ticket costs its holder a place they already waited for.
     */
    protected const TICKET_IDLE_SECONDS = 20;

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
     * Ask to run a turn now. Returns a held slot or a place in the queue;
     * never blocks or sleeps.
     *
     * @param string $ownerKey identity for per-user fairness (typically the user uuid)
     * @param string|null $ticket the place this caller already holds, if any
     *
     * @throws AIServiceException when the queue is full, the caller already has
     *                            a turn in flight, or a presented ticket has lapsed
     */
    public function admit(string $ownerKey, string $lane = self::LANE_NEW, ?string $ticket = null): Admission
    {
        if (!$this->applies()) {
            return Admission::hold(TurnLease::passthrough());
        }

        $held = $ticket === null ? null : $this->ticket($ticket, $ownerKey);

        if ($ticket !== null && $held === null) {
            // Either it lapsed or it was never ours. Both mean the place is
            // gone, and silently rejoining at the back would tell somebody who
            // has already waited two minutes that they are position nine again.
            throw new AIServiceException('The AI is busy and did not free up in time. Please try again in a moment.');
        }

        // Reserve before joining the queue. A queued turn is work the user has
        // asked for, so excluding it would make the per-user limit ineffective
        // under exactly the contention it exists for. The small per-user lock
        // makes the check plus increment one admission decision rather than two
        // racing cache operations.
        $reservation = $held['reservation'] ?? $this->reserveUser($ownerKey);

        try {
            return $this->place($reservation, $lane, $held);
        } catch (\Throwable $e) {
            // A returning ticket owns its reservation through the failure; a
            // new arrival's was taken moments ago for an attempt that is over.
            if ($held === null) {
                $this->releaseUser($reservation);
            }

            throw $e;
        }
    }

    /**
     * Give up a queue place. The idle timeout would collect it anyway, but a
     * user who pressed Stop should not be told they still have one queued.
     */
    public function releaseTicket(string $ticket, string $ownerKey): bool
    {
        if (!$this->applies()) {
            return false;
        }

        $reservation = null;

        $this->withQueue(function (array $queue) use ($ticket, $ownerKey, &$reservation): array {
            $held = $queue[$ticket] ?? null;

            if ($held === null || !hash_equals((string) $held['owner'], $ownerKey)) {
                return $queue;
            }

            $reservation = $held['reservation'];
            unset($queue[$ticket]);

            return $queue;
        });

        if ($reservation === null) {
            return false;
        }

        $this->releaseUser($reservation);

        return true;
    }

    /**
     * Whether admission control applies to the configured provider. Hosted
     * providers are bounded by budgets, not hardware, so they skip it.
     */
    public function applies(): bool
    {
        return in_array($this->factory->provider(), ProviderConfig::SELF_HOSTED, true);
    }

    /*
    |--------------------------------------------------------------------------
    | The queue
    |--------------------------------------------------------------------------
    */

    /**
     * Take a slot if this caller is entitled to one, or hold its place.
     *
     * @param array{ownerKey: string, token: string} $reservation
     * @param Ticket|null $held the caller's existing ticket, if it presented one
     *
     * @throws AIServiceException
     */
    protected function place(array $reservation, string $lane, ?array $held): Admission
    {
        $lease = null;
        $token = $held['token'] ?? (string) Str::uuid();
        $ahead = 0;

        $this->withQueue(function (array $queue) use (&$lease, &$ahead, $reservation, $lane, $held, $token): array {
            $seq = $held['seq'] ?? $this->nextSequence($queue);
            $mine = ['lane' => $lane, 'seq' => $seq];

            $ahead = 0;
            foreach ($queue as $other) {
                if ($other['token'] !== $token && $this->outranks($other, $mine)) {
                    ++$ahead;
                }
            }

            // Contend only for slots nobody ahead has a claim on. Letting every
            // waiter race would make position advisory, and the user who
            // arrived first would watch later ones overtake them.
            if ($ahead < $this->slots() - $this->slotsInUse()) {
                $lease = $this->tryGrabSlot($reservation);

                if ($lease !== null) {
                    unset($queue[$token]);

                    return $queue;
                }
            }

            // Only now, having established that this caller must wait. The
            // check bounds the *queue*, not the service: a depth of zero means
            // a turn that cannot start immediately is refused, and running that
            // check first would have refused turns a slot was standing free for.
            if ($held === null && count($queue) >= $this->maxQueueDepth()) {
                throw new AIServiceException('The AI is at capacity right now and the queue is full. Please try again in a minute.');
            }

            $queue[$token] = [
                'token' => $token,
                'owner' => $reservation['ownerKey'],
                'lane' => $lane,
                'seq' => $seq,
                'issued' => $held['issued'] ?? $this->now(),
                'seen' => $this->now(),
                'reservation' => $reservation,
            ];

            return $queue;
        });

        if ($lease !== null) {
            return Admission::hold($lease);
        }

        return Admission::wait($token, $ahead, $this->estimatedWaitSeconds($ahead), $this->retryAfterMs($ahead));
    }

    /**
     * This caller's live ticket, if it still has one.
     *
     * @return Ticket|null the ticket, or null when it lapsed or belongs to somebody else
     */
    protected function ticket(string $token, string $ownerKey): ?array
    {
        $found = null;

        $this->withQueue(function (array $queue, array &$abandoned) use ($token, $ownerKey, &$found): array {
            $held = $queue[$token] ?? null;

            if ($held === null || !hash_equals((string) $held['owner'], $ownerKey)) {
                return $queue;
            }

            // The total wait is bounded by the same setting the blocking gate
            // used, now measured from when the place was first taken rather
            // than by how long a worker sat on a sleep loop.
            if ($this->now() - $held['issued'] > $this->maxWaitSeconds()) {
                unset($queue[$token]);
                $abandoned[] = $held['reservation'];

                return $queue;
            }

            $found = $held;

            return $queue;
        });

        return $found;
    }

    /**
     * Mutate the queue under the admission lock, pruning what has lapsed.
     *
     * Reservations from dropped tickets are released *after* the lock: every
     * other path takes the per-user lock first, so the reverse order would be a
     * lock inversion. They travel by reference rather than on `$this` so they
     * cannot outlive a call that threw.
     *
     * @param \Closure(array<string, Ticket>, list<array{ownerKey: string, token: string}>): array<string, Ticket> $mutate
     */
    protected function withQueue(\Closure $mutate): void
    {
        $lock = Cache::lock(self::ADMISSION_LOCK_KEY, 5);
        $lock->block(5);

        /** @var list<array{ownerKey: string, token: string}> $abandoned */
        $abandoned = [];

        try {
            [$queue, $abandoned] = $this->prune(Cache::get(self::QUEUE_KEY, []));

            Cache::put(self::QUEUE_KEY, $mutate($queue, $abandoned), $this->maxWaitSeconds() + 60);
        } finally {
            $lock->release();

            foreach ($abandoned as $reservation) {
                $this->releaseUser($reservation);
            }
        }
    }

    /**
     * Drop tickets nobody is presenting any more. Self-healing rather than
     * reaped — a closed tab, a lost connection and a navigation away are all
     * the same event from here, and none of them announce themselves.
     *
     * @param array<string, Ticket> $queue
     *
     * @return array{0: array<string, Ticket>, 1: list<array{ownerKey: string, token: string}>}
     */
    protected function prune(array $queue): array
    {
        $now = $this->now();
        $wait = $this->maxWaitSeconds();
        $abandoned = [];

        foreach ($queue as $token => $held) {
            if ($now - $held['seen'] > self::TICKET_IDLE_SECONDS || $now - $held['issued'] > $wait) {
                $abandoned[] = $held['reservation'];
                unset($queue[$token]);
            }
        }

        return [$queue, $abandoned];
    }

    /**
     * Whether one ticket is served before another: resumes outrank new turns,
     * and within a lane it is arrival order.
     *
     * @param Ticket|array{lane: string, seq: int} $a
     * @param Ticket|array{lane: string, seq: int} $b
     */
    protected function outranks(array $a, array $b): bool
    {
        if ($a['lane'] !== $b['lane']) {
            return $a['lane'] === self::LANE_RESUME;
        }

        return $a['seq'] < $b['seq'];
    }

    /** @param array<string, Ticket> $queue */
    protected function nextSequence(array $queue): int
    {
        $highest = 0;

        foreach ($queue as $held) {
            $highest = max($highest, (int) $held['seq']);
        }

        return $highest + 1;
    }

    /**
     * How soon to come back. Scaled with depth so a long queue is not also a
     * busy one, and capped so the front of it stays responsive.
     */
    protected function retryAfterMs(int $ahead): int
    {
        return (int) min(4000, 750 + 250 * $ahead);
    }

    /**
     * Try each slot once. The first uncontended lock wins.
     */
    protected function tryGrabSlot(array $reservation): ?TurnLease
    {
        $ttl = $this->leaseTtlSeconds();

        for ($slot = 0; $slot < $this->slots(); ++$slot) {
            $lock = Cache::lock(self::SLOT_KEY . $slot, $ttl);

            if ($lock->get()) {
                return TurnLease::held($slot, $lock, $reservation, function () use ($reservation) {
                    $this->releaseUser($reservation);
                });
            }
        }

        return null;
    }

    /**
     * Release a lease this process never acquired — a request takes the slot,
     * a worker gives it back. `Cache::restoreLock()` rebuilds the lock from its
     * name and owner token, and that token is what keeps a late release honest:
     * a lease already retaken by someone else releases nothing.
     *
     * Idempotent and never throws; called from job teardown, where raising
     * would replace the real error.
     *
     * @param array{slot: int, owner: string, reservation: array{ownerKey: string, token: string}} $handle
     */
    public function releaseHandle(array $handle): void
    {
        try {
            Cache::restoreLock(self::SLOT_KEY . $handle['slot'], $handle['owner'])->release();
            $this->releaseUser($handle['reservation']);
        } catch (\Throwable $e) {
            Log::warning('Failed to release an AI inference lease handle: ' . $e->getMessage());
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Per-user fairness
    |--------------------------------------------------------------------------
    */

    /**
     * @return array{ownerKey: string, token: string}
     *
     * @throws AIServiceException
     */
    protected function reserveUser(string $ownerKey): array
    {
        $lock = Cache::lock(self::USER_LOCK_KEY . sha1($ownerKey), 5);

        return $lock->block(5, function () use ($ownerKey) {
            $limit = $this->perUserLimit();

            if ($limit > 0 && $this->activeForUser($ownerKey) >= $limit) {
                throw new AIServiceException('You already have an AI request running or queued. Wait for it to finish before starting another.');
            }

            $token = (string) Str::uuid();
            $ttl = $this->reservationTtlSeconds();
            Cache::put(self::USER_RESERVATION_KEY . $token, $ownerKey, $ttl);

            $key = self::USER_KEY . $ownerKey;
            if (!Cache::add($key, 1, $ttl)) {
                Cache::increment($key);
            }

            return compact('ownerKey', 'token');
        });
    }

    public function activeForUser(string $ownerKey): int
    {
        return max(0, (int) Cache::get(self::USER_KEY . $ownerKey, 0));
    }

    protected function releaseUser(array $reservation): void
    {
        $ownerKey = (string) ($reservation['ownerKey'] ?? '');
        $token = (string) ($reservation['token'] ?? '');

        if ($ownerKey === '' || $token === '') {
            return;
        }

        $lock = Cache::lock(self::USER_LOCK_KEY . sha1($ownerKey), 5);
        $lock->block(5, function () use ($ownerKey, $token) {
            // A token-specific key means a late release from an expired lease
            // cannot decrement a newer owner's counter.
            if (Cache::pull(self::USER_RESERVATION_KEY . $token) !== $ownerKey) {
                return;
            }

            $key = self::USER_KEY . $ownerKey;
            if (Cache::decrement($key) <= 0) {
                Cache::forget($key);
            }
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Queue bookkeeping
    |--------------------------------------------------------------------------
    */

    public function waiting(string $lane): int
    {
        $waiting = 0;

        foreach ($this->live() as $held) {
            if ($held['lane'] === $lane) {
                ++$waiting;
            }
        }

        return $waiting;
    }

    public function queueDepth(): int
    {
        return count($this->live());
    }

    /**
     * The queue as it stands, without taking the lock. Read-only callers need
     * no serialisation, and lapsed tickets are filtered rather than collected
     * so a status read never mutates anything.
     *
     * @return array<string, Ticket>
     */
    protected function live(): array
    {
        $now = $this->now();
        $wait = $this->maxWaitSeconds();

        return array_filter(
            Cache::get(self::QUEUE_KEY, []),
            fn (array $held): bool => $now - $held['seen'] <= self::TICKET_IDLE_SECONDS
                && $now - $held['issued'] <= $wait,
        );
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

    /**
     * How many turns may hold a queue place. Zero means no queue — a turn that
     * cannot have a slot immediately is refused rather than made to wait, which
     * `place()` enforces without a special case since zero is never under the
     * limit. Not clamped against the worker pool; queueing costs no worker.
     */
    public function maxQueueDepth(): int
    {
        return max(0, (int) $this->setting(
            'concurrency:queue_depth',
            config('modules.ai.concurrency.queue_depth', 20)
        ));
    }

    /**
     * The longest a turn may hold a queue place before being told to give up.
     */
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

    /**
     * A reservation covers queueing plus the bounded turn and a crash margin.
     */
    protected function reservationTtlSeconds(): int
    {
        return $this->maxWaitSeconds() + $this->leaseTtlSeconds();
    }

    protected function setting(string $key, mixed $default = null): mixed
    {
        return Setting::get('settings::modules:ai:' . $key, $default);
    }

    /**
     * Wall clock, as a test seam. Ticket ages are real seconds rather than
     * Carbon — they bound a wait a user is sitting through, so travelling
     * Laravel's clock would not move them.
     */
    protected function now(): float
    {
        return microtime(true);
    }
}
