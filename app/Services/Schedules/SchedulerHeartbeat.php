<?php

namespace Everest\Services\Schedules;

use Illuminate\Support\Carbon;
use Illuminate\Contracts\Cache\Repository as Cache;

/**
 * Records that the Laravel scheduler is actually being invoked, so the admin
 * queue page can tell a healthy panel from a silent one.
 *
 * This closes the blind spot the queue view has on its own. Cron and the queue
 * are separate systems: `schedule:run` finds due work and dispatches some of it
 * onto a queue, and if the cron entry stops, every lane stays clear and every
 * worker stays green while nothing scheduled happens at all. Horizon cannot see
 * that, because the scheduler sits upstream of it.
 *
 * The signal is `schedule:run` starting, not a task finishing. A tick where
 * nothing was due still proves cron is alive, and on an install where the only
 * per-minute tasks are behind a module flag, waiting for a task would report a
 * working cron as dead.
 *
 * Everything here is advisory: writes are guarded so a cache problem can never
 * take down the scheduler, and every read degrades to "unknown" rather than to
 * a false alarm.
 */
class SchedulerHeartbeat
{
    private const TICK_KEY = 'schedule:heartbeat';
    private const RECENT_KEY = 'schedule:recent-tasks';
    private const FAILURE_KEY = 'schedule:last-failure';

    /**
     * How long a record outlives its write. Long enough to still report "cron
     * last ran six hours ago", which is far more useful than the record simply
     * vanishing and reading as "never configured".
     */
    private const TTL_SECONDS = 86400;

    /** Recent tasks kept for the page. A tick runs a handful; this holds a few. */
    private const RECENT_LIMIT = 12;

    /** Two missed minutes is a blip; ten is a broken cron entry. */
    public const STALE_SECONDS = 180;
    public const CRITICAL_SECONDS = 600;

    public function __construct(private Cache $cache)
    {
    }

    /**
     * Cron invoked the scheduler. Called from `CommandStarting`.
     */
    public function beat(): void
    {
        $this->write(self::TICK_KEY, [
            'ranAt' => now()->toIso8601ZuluString(),
            'host' => gethostname() ?: 'unknown',
            'pid' => getmypid(),
        ]);
    }

    /**
     * One scheduled task finished. This is what answers "is *this* thing
     * running", which the queue page cannot show for any task that does its
     * work inline instead of dispatching a job.
     */
    public function recordFinished(string $task, ?float $runtimeMs = null): void
    {
        $task = $this->normalise($task);

        $this->push([
            'task' => $task,
            'ranAt' => now()->toIso8601ZuluString(),
            'runtimeMs' => $runtimeMs === null ? null : (int) round($runtimeMs),
            'ok' => true,
        ]);

        // The warning represents a task that is still failing, not immutable
        // history. Once that same task succeeds it has recovered.
        $lastFailure = $this->read(self::FAILURE_KEY);
        if (is_array($lastFailure) && ($lastFailure['task'] ?? null) === $task) {
            $this->forget(self::FAILURE_KEY);
        }
    }

    /**
     * A scheduled task threw. Kept separately as well as in the ring, because
     * the last failure is worth surfacing long after it has aged out of the
     * recent list.
     */
    public function recordFailed(string $task, string $error): void
    {
        $entry = [
            'task' => $this->normalise($task),
            'ranAt' => now()->toIso8601ZuluString(),
            'runtimeMs' => null,
            'ok' => false,
        ];

        $this->push($entry);

        $this->write(self::FAILURE_KEY, $entry + [
            // Bounded: a stack trace has no business in a cache entry that is
            // rendered into an admin page.
            'error' => mb_substr($error, 0, 500),
        ]);
    }

    /**
     * Everything the page needs, with the staleness already judged.
     *
     * Read-only, and deliberately the only public read: the queue snapshot has
     * no business knowing which cache keys this uses.
     *
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        $tick = $this->read(self::TICK_KEY);
        $ranAt = is_array($tick) && is_string($tick['ranAt'] ?? null) ? $tick['ranAt'] : null;
        $secondsAgo = $this->ageOf($ranAt);
        $recent = $this->recent();
        $lastFailure = $this->read(self::FAILURE_KEY);

        // Reconcile cache entries written before recovery-clearing existed.
        // The ring keeps only the newest result for each task, so a successful
        // row for this task proves the retained failure is no longer current.
        if (
            is_array($lastFailure)
            && collect($recent)->contains(
                fn (array $row): bool => ($row['task'] ?? null) === ($lastFailure['task'] ?? null)
                && ($row['ok'] ?? false) === true
            )
        ) {
            $this->forget(self::FAILURE_KEY);
            $lastFailure = null;
        }

        return [
            'ranAt' => $ranAt,
            'secondsAgo' => $secondsAgo,
            'host' => $tick['host'] ?? null,
            'pid' => $tick['pid'] ?? null,
            // `null` is "never seen", which is a different thing from stale and
            // is reported differently: on a panel installed a minute ago it is
            // not yet evidence of anything.
            'severity' => $this->severity($secondsAgo),
            'staleAfterSeconds' => self::STALE_SECONDS,
            'recent' => $recent,
            'lastFailure' => $lastFailure,
        ];
    }

    /**
     * @return 'ok'|'stale'|'down'|'unknown'
     */
    private function severity(?int $secondsAgo): string
    {
        if ($secondsAgo === null) {
            return 'unknown';
        }

        if ($secondsAgo >= self::CRITICAL_SECONDS) {
            return 'down';
        }

        return $secondsAgo >= self::STALE_SECONDS ? 'stale' : 'ok';
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recent(): array
    {
        $recent = $this->read(self::RECENT_KEY);

        return is_array($recent) ? array_values(array_filter($recent, 'is_array')) : [];
    }

    /**
     * @param array<string, mixed> $entry
     */
    private function push(array $entry): void
    {
        $recent = $this->recent();

        // Newest first, one row per task: a task that runs every minute would
        // otherwise fill the whole ring and hide everything else.
        $recent = array_values(array_filter(
            $recent,
            fn (array $row) => ($row['task'] ?? null) !== $entry['task']
        ));

        array_unshift($recent, $entry);

        $this->write(self::RECENT_KEY, array_slice($recent, 0, self::RECENT_LIMIT));
    }

    private function ageOf(?string $iso): ?int
    {
        if ($iso === null) {
            return null;
        }

        try {
            return max(0, (int) now()->diffInSeconds(Carbon::parse($iso), true));
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Task names arrive as the full command line Laravel built, which carries
     * the PHP binary and artisan path. Only the command matters here.
     */
    private function normalise(string $task): string
    {
        if (preg_match("/artisan'?\s+(.+)$/", $task, $matches) === 1) {
            $task = $matches[1];
        }

        return trim(mb_substr($task, 0, 120));
    }

    private function write(string $key, mixed $value): void
    {
        try {
            $this->cache->put($key, $value, self::TTL_SECONDS);
        } catch (\Throwable) {
            // Advisory only. The scheduler must never fail because the cache is
            // unreachable -- that would turn a monitoring feature into an outage.
        }
    }

    private function read(string $key): mixed
    {
        try {
            return $this->cache->get($key);
        } catch (\Throwable) {
            return null;
        }
    }

    private function forget(string $key): void
    {
        try {
            $this->cache->forget($key);
        } catch (\Throwable) {
            // Advisory only, for the same reason reads and writes are guarded.
        }
    }
}
