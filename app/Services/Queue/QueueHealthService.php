<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Contracts\Cache\LockProvider;
use Laravel\Horizon\Contracts\MetricsRepository;
use Laravel\Horizon\Contracts\WorkloadRepository;
use Laravel\Horizon\Contracts\SupervisorRepository;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;
use Illuminate\Contracts\Cache\Repository as CacheRepository;

/**
 * One snapshot of worker-queue health, assembled for /admin/queues.
 *
 * Deliberately distinct from OverviewController::queues(), which reports
 * *business* backlog -- open tickets, billing exceptions. This is the
 * infrastructure view: what is queued, what is draining it, and what is wrong.
 *
 * Horizon supplies depth, wait, throughput and runtime. The worker heartbeat
 * supplies the thing Horizon cannot: whether a process is genuinely consuming a
 * lane right now. Together they distinguish "busy" from "nobody is listening",
 * which is the difference between a slow queue and a silently broken one.
 *
 * Cached briefly behind a lock so a room full of admins polling the dashboard
 * computes it once, following InferenceGate's single-flight discipline.
 */
class QueueHealthService
{
    private const CACHE_KEY = 'queue:health:snapshot';
    private const LOCK_KEY = 'queue:health:lock';
    private const TTL_SECONDS = 10;

    public function __construct(
        private QueueTopology $topology,
        private QueueWorkerHeartbeat $heartbeat,
        private HorizonEnvironmentGuard $guard,
        private CacheRepository $cache,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        $cached = $this->cache->get(self::CACHE_KEY);

        return is_array($cached) ? $cached : $this->computeOnce();
    }

    /**
     * Bypass the cache. An operator running the artisan command is asking about
     * now, not about ten seconds ago.
     *
     * @return array<string, mixed>
     */
    public function fresh(): array
    {
        $snapshot = $this->compute();

        $this->cache->put(self::CACHE_KEY, $snapshot, self::TTL_SECONDS);

        return $snapshot;
    }

    /**
     * @return array<string, mixed>
     */
    private function computeOnce(): array
    {
        if (!$this->cache->getStore() instanceof LockProvider) {
            return $this->fresh();
        }

        $lock = Cache::lock(self::LOCK_KEY, self::TTL_SECONDS);

        if (!$lock->get()) {
            // Another request is already building it. Wait briefly for their
            // result rather than duplicating the work; if it does not arrive,
            // compute without caching so this caller still gets an answer.
            usleep(150_000);

            $cached = $this->cache->get(self::CACHE_KEY);

            return is_array($cached) ? $cached : $this->compute();
        }

        try {
            return $this->fresh();
        } finally {
            $lock->release();
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function compute(): array
    {
        $workload = $this->workloadByQueue();
        $consumed = $this->heartbeat->consumedQueues();
        $masters = $this->masters();

        $lanes = [];
        $totalDepth = 0;

        foreach ($this->topology->lanes() as $lane => $queue) {
            $entry = $workload[$queue] ?? [];

            // Horizon derives workload from its running supervisors, so it
            // reports nothing at all when Horizon is down -- which is exactly
            // when an operator most needs to see how much work is piling up.
            // Fall back to asking the driver directly.
            $depth = $entry['length'] ?? $this->depthFromDriver($lane, $queue);
            $totalDepth += max(0, (int) $depth);

            $lanes[] = [
                'lane' => $lane,
                'queue' => $queue,
                'connection' => $this->topology->resolvedConnectionFor($lane),
                'long' => $this->topology->isLong($lane),
                'retryAfter' => $this->topology->retryAfterFor($lane),
                'expected' => $this->topology->isExpected($lane),
                'consumed' => in_array($queue, $consumed, true),
                'depth' => $depth,
                'waitSeconds' => $entry['wait'] ?? null,
                'processes' => $entry['processes'] ?? null,
                ...$this->windowed('queue', $queue),
            ];
        }

        return [
            'generatedAt' => now()->toIso8601ZuluString(),
            'environment' => [
                'supported' => $this->guard->isSupported(),
                'problems' => $this->guard->problems(),
            ],
            'horizon' => [
                'running' => $masters !== [],
                'paused' => $masters !== [] && collect($masters)->every(fn ($m) => ($m['status'] ?? null) === 'paused'),
                'masters' => $masters,
                'supervisors' => $this->supervisors(),
            ],
            // How far back the throughput figures reach, so the page can label
            // them rather than implying they are all-time totals.
            'metricsWindowMinutes' => collect($lanes)->pluck('windowMinutes')->filter()->max(),
            'defaultConnection' => $this->topology->defaultConnection(),
            'longConnection' => $this->topology->longConnection(),
            'totalDepth' => $totalDepth,
            'lanes' => $lanes,
            'jobs' => $this->jobMetrics(),
            'workers' => $this->heartbeat->workers(),
            'failed' => $this->failedJobs(),
            'warnings' => $this->warnings($lanes, $masters),
        ];
    }

    /**
     * What an operator should act on, worst first.
     *
     * @param list<array<string, mixed>> $lanes
     * @param list<array<string, mixed>> $masters
     *
     * @return list<array{code: string, severity: string, message: string}>
     */
    private function warnings(array $lanes, array $masters): array
    {
        $warnings = [];

        foreach ($this->guard->problems() as $problem) {
            $warnings[] = ['code' => $problem['code'], 'severity' => 'critical', 'message' => $problem['problem'] . ' ' . $problem['fix']];
        }

        if ($masters === []) {
            $warnings[] = [
                'code' => 'horizon_not_running',
                'severity' => 'critical',
                'message' => 'No Horizon process is running, so nothing is processing queued work. Start it with `systemctl start m12labs.service`.',
            ];

            // Every lane is unconsumed in this case; saying so per lane would
            // bury the one thing that actually needs doing.
            return $warnings;
        }

        foreach ($lanes as $lane) {
            if ($lane['consumed'] || !$lane['expected']) {
                continue;
            }

            $warnings[] = [
                'code' => 'lane_without_consumer',
                'severity' => ((int) $lane['depth']) > 0 ? 'critical' : 'warning',
                'message' => ((int) $lane['depth']) > 0
                    ? "The [{$lane['lane']}] queue has {$lane['depth']} job(s) waiting and no worker consuming it."
                    : "No worker is consuming the [{$lane['lane']}] queue. Work routed there would never run.",
            ];
        }

        return $warnings;
    }

    /**
     * Pending job count straight from the queue driver, or null when it cannot
     * be reached -- which is worth showing, since it is not the same as empty.
     */
    private function depthFromDriver(string $lane, string $queue): ?int
    {
        try {
            return Queue::connection($this->topology->connectionFor($lane))->size($queue);
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not size queue', ['lane' => $lane, 'error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * Horizon reports workload per *supervisor queue group*, so a supervisor
     * draining seven queues arrives as one comma-joined entry with the
     * per-queue breakdown in `split_queues`. Flatten both shapes to queue name.
     *
     * @return array<string, array<string, mixed>>
     */
    private function workloadByQueue(): array
    {
        $byQueue = [];

        try {
            foreach (app(WorkloadRepository::class)->get() as $entry) {
                $entry = (array) $entry;
                $split = $entry['split_queues'] ?? null;

                if ($split) {
                    foreach ($split as $part) {
                        $part = (array) $part;
                        $byQueue[$part['name']] = $part + ['processes' => $entry['processes'] ?? null];
                    }

                    continue;
                }

                $byQueue[$entry['name']] = $entry;
            }
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read Horizon workload', ['error' => $e->getMessage()]);
        }

        return $byQueue;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function masters(): array
    {
        try {
            return collect(app(MasterSupervisorRepository::class)->all())
                ->map(fn ($master) => [
                    'name' => $master->name ?? null,
                    'status' => $master->status ?? null,
                    'pid' => $master->pid ?? null,
                ])
                ->values()
                ->all();
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read Horizon masters', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function supervisors(): array
    {
        try {
            return collect(app(SupervisorRepository::class)->all())
                ->map(fn ($supervisor) => [
                    'name' => $supervisor->name ?? null,
                    'status' => $supervisor->status ?? null,
                    'processes' => array_sum((array) ($supervisor->processes ?? [])),
                    'queues' => array_values(array_filter(explode(',', (string) Arr::get((array) $supervisor, 'options.queue', '')))),
                ])
                ->values()
                ->all();
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read Horizon supervisors', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * Per-job-class throughput and runtime, which is what tells an operator
     * *which* job is slow rather than merely that a lane is.
     *
     * @return list<array<string, mixed>>
     */
    private function jobMetrics(): array
    {
        try {
            $metrics = app(MetricsRepository::class);

            return collect($metrics->measuredJobs())
                ->map(fn ($job) => [
                    'job' => $job,
                    ...$this->windowed('job', $job),
                ])
                ->sortByDesc('processed')
                ->values()
                ->all();
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read Horizon job metrics', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * Throughput and average runtime over the retained snapshot window.
     *
     * Horizon's live counters cannot be read on their own. `horizon:snapshot`
     * rolls them into a time series every five minutes and *deletes* them on the
     * way past (RedisMetricsRepository::baseSnapshotData does an hmget followed
     * by a del), so anything reading the counters directly shows a number that
     * keeps collapsing back to zero -- which made a perfectly busy panel look
     * like nothing had ever run.
     *
     * So the retained snapshots are summed, with the live counter added on top
     * to cover the minutes since the last one. Runtime is averaged weighted by
     * throughput; a straight mean of the per-snapshot averages would let one
     * idle five-minute window count as much as a busy one.
     *
     * These reads hit Redis and can fail independently of the rest of the
     * snapshot; a missing number must not cost the whole page.
     *
     * @return array{processed: ?int, avgRuntimeMs: ?float, windowMinutes: ?int}
     */
    private function windowed(string $type, string $name): array
    {
        try {
            $metrics = app(MetricsRepository::class);

            $snapshots = $type === 'queue' ? $metrics->snapshotsForQueue($name) : $metrics->snapshotsForJob($name);
            $processed = (int) ($type === 'queue' ? $metrics->throughputForQueue($name) : $metrics->throughputForJob($name));
            $runtimeSum = (float) ($type === 'queue' ? $metrics->runtimeForQueue($name) : $metrics->runtimeForJob($name)) * $processed;
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read Horizon metrics', ['name' => $name, 'error' => $e->getMessage()]);

            return ['processed' => null, 'avgRuntimeMs' => null, 'windowMinutes' => null];
        }

        $earliest = null;

        foreach ($snapshots as $snapshot) {
            $count = (int) ($snapshot->throughput ?? 0);
            $processed += $count;
            $runtimeSum += (float) ($snapshot->runtime ?? 0) * $count;

            $time = (int) ($snapshot->time ?? 0);

            if ($time > 0 && ($earliest === null || $time < $earliest)) {
                $earliest = $time;
            }
        }

        return [
            'processed' => $processed,
            'avgRuntimeMs' => $processed > 0 ? round($runtimeSum / $processed, 2) : null,
            'windowMinutes' => $earliest === null ? null : max(1, (int) round((time() - $earliest) / 60)),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function failedJobs(): array
    {
        $unavailable = ['total' => null, 'lastDay' => null, 'oldestFailedAt' => null];

        $table = config('queue.failed.table');
        $connection = config('queue.failed.database');

        if (!is_string($table) || !str_starts_with((string) config('queue.failed.driver'), 'database')) {
            return $unavailable;
        }

        try {
            if (!Schema::connection($connection)->hasTable($table)) {
                return $unavailable;
            }

            $query = DB::connection($connection)->table($table);

            return [
                'total' => (int) $query->clone()->count(),
                'lastDay' => (int) $query->clone()->where('failed_at', '>=', now()->subDay())->count(),
                'oldestFailedAt' => $query->clone()->min('failed_at'),
            ];
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read failed jobs', ['error' => $e->getMessage()]);

            return $unavailable;
        }
    }
}
