<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Str;
use Illuminate\Contracts\Cache\Repository as Cache;

/**
 * Records that a worker process is alive and which queues it is draining.
 *
 * Horizon's own supervisor records answer "is Horizon running". This answers
 * the more useful question for an operator: is anything actually consuming
 * *this lane*. It is written from the worker's own loop, so it reflects
 * processes that exist rather than processes that were configured -- which is
 * how a lane with a supervisor sized to zero, or a supervisor that died, gets
 * noticed.
 *
 * Cheap by construction: one small cache write per worker per interval, keyed
 * by host and PID, expiring on its own. Nothing to prune.
 */
class QueueWorkerHeartbeat
{
    private const PREFIX = 'queue:worker:';
    private const INDEX = 'queue:workers';

    /** How often a worker re-announces itself. */
    private const INTERVAL_SECONDS = 15;

    /** Silence for longer than this and the worker is presumed gone. */
    private const TTL_SECONDS = 90;

    /** Last write time per worker key, so the queue loop is not a cache write loop. */
    private array $lastWrite = [];

    /** The record this process last wrote, so a long job can keep it alive. */
    private ?string $currentKey = null;

    /** @var array<string, mixed>|null */
    private ?array $currentRecord = null;

    public function __construct(private Cache $cache)
    {
    }

    /**
     * Called from the worker's loop. Throttled, and guarded so a cache problem
     * can never take a worker down.
     */
    public function beat(?string $connection, ?string $queue): void
    {
        $key = $this->keyFor($connection, $queue);
        $now = microtime(true);

        if (isset($this->lastWrite[$key]) && ($now - $this->lastWrite[$key]) < self::INTERVAL_SECONDS) {
            return;
        }

        $this->lastWrite[$key] = $now;

        $this->currentKey = $key;
        $this->currentRecord = [
            'host' => gethostname() ?: 'unknown',
            'pid' => getmypid(),
            'connection' => $connection,
            'queues' => $this->queuesFrom($queue),
            'seenAt' => now()->toIso8601ZuluString(),
        ];

        $this->write(self::TTL_SECONDS);
    }

    /**
     * Keep this worker visible for the length of a job it is about to run.
     *
     * `Looping` fires only *between* jobs -- Worker::daemonShouldRun() raises it
     * at the top of the loop, before runNextJob() takes over. A worker inside a
     * 60-minute modpack install therefore stops announcing itself once the
     * 90-second TTL lapses, and gets reported as gone at exactly the moment it
     * is doing the most work: the lane shows no consumer and the page warns
     * about a worker that is perfectly healthy.
     *
     * So the record is written to outlive the job. A job that overruns its own
     * timeout is killed by the worker, so this cannot hide a genuinely dead
     * process for longer than the job could legitimately have taken.
     */
    public function holdThroughJob(?int $timeoutSeconds): void
    {
        if ($this->currentRecord === null) {
            return;
        }

        $this->write(max(self::TTL_SECONDS, (int) $timeoutSeconds + self::TTL_SECONDS));
    }

    /**
     * Guarded so a cache problem can never take a worker down.
     */
    private function write(int $ttl): void
    {
        try {
            $this->cache->put(self::PREFIX . $this->currentKey, $this->currentRecord, $ttl);

            $this->register((string) $this->currentKey, $ttl);
        } catch (\Throwable) {
            // Advisory only.
        }
    }

    /**
     * Every worker seen recently.
     *
     * @return list<array{host: string, pid: int|null, connection: ?string, queues: list<string>, seenAt: string}>
     */
    public function workers(): array
    {
        $workers = [];

        foreach ($this->index() as $key) {
            $worker = $this->cache->get(self::PREFIX . $key);

            if (is_array($worker)) {
                $workers[] = $worker;
            }
        }

        return $workers;
    }

    /**
     * Queue names with at least one live consumer.
     *
     * @return list<string>
     */
    public function consumedQueues(): array
    {
        $queues = [];

        foreach ($this->workers() as $worker) {
            foreach ($worker['queues'] ?? [] as $queue) {
                $queues[$queue] = true;
            }
        }

        return array_keys($queues);
    }

    /**
     * The index lets the panel enumerate workers without a Redis KEYS scan,
     * which would be both slow and unavailable on other cache stores. Entries
     * are only appended when a worker is new, and stale ones fall out because
     * the record they point at expires.
     */
    private function register(string $key, int $ttl): void
    {
        $index = $this->index();

        if (!in_array($key, $index, true)) {
            $index[] = $key;

            // Bounded: anything whose record has expired is dropped on the way in.
            $index = array_values(array_filter($index, fn ($k) => $k === $key || $this->cache->has(self::PREFIX . $k)));
        }

        // Re-put on every beat. This used to be written only when a key was new,
        // so the index expired on its own TTL underneath workers that were still
        // beating -- and until the next beat rebuilt it the panel saw no workers
        // at all and warned that every lane had lost its consumer.
        $this->cache->put(self::INDEX, $index, max(self::TTL_SECONDS * 4, $ttl + self::TTL_SECONDS));
    }

    /**
     * @return list<string>
     */
    private function index(): array
    {
        $index = $this->cache->get(self::INDEX, []);

        return is_array($index) ? array_values(array_filter($index, 'is_string')) : [];
    }

    private function keyFor(?string $connection, ?string $queue): string
    {
        return substr(sha1((gethostname() ?: '') . '|' . getmypid() . '|' . $connection . '|' . $queue), 0, 16);
    }

    /**
     * A worker's queue is the raw --queue string, so a multi-lane worker
     * arrives comma-joined. Redis also namespaces names as `queues:mail`.
     *
     * @return list<string>
     */
    private function queuesFrom(?string $queue): array
    {
        return array_values(array_filter(array_map(
            fn (string $name) => Str::contains($name, ':') ? Str::afterLast($name, ':') : trim($name),
            explode(',', (string) $queue)
        )));
    }
}
