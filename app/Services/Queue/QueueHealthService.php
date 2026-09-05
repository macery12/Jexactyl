<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Contracts\Cache\LockProvider;
use Laravel\Horizon\Contracts\MetricsRepository;
use Laravel\Horizon\Contracts\WorkloadRepository;
use Everest\Services\Schedules\SchedulerHeartbeat;
use Laravel\Horizon\Contracts\SupervisorRepository;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;
use Illuminate\Contracts\Cache\Repository as CacheRepository;

/**
 * One snapshot of worker-queue health for /admin/queues — the infrastructure
 * view of what is queued, what is draining it and what is wrong. Distinct from
 * `OverviewController::queues()`, which reports *business* backlog.
 *
 * Horizon supplies depth, wait, throughput and runtime; the worker heartbeat
 * supplies what it cannot — whether a process is genuinely consuming a lane
 * right now. Together they separate "busy" from "nobody is listening".
 *
 * Cached briefly behind a lock so a room full of admins computes it once.
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
        private QueueWaitEstimator $waits,
        private JobCatalogue $catalogue,
        private SchedulerHeartbeat $scheduler,
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
        $scheduler = $this->scheduler->snapshot();
        $workers = $this->heartbeat->workers();
        $consumed = $this->heartbeat->consumedQueues();
        $masters = $this->masters();
        $supervisors = $this->supervisors();

        $lanes = [];
        $totalDepth = 0;
        $clearMs = [];

        foreach ($this->topology->lanes() as $lane => $queue) {
            $entry = $workload[$queue] ?? [];

            // Depth is always asked of the driver, so the number means one
            // thing. Horizon reports `readyNow` -- jobs available this instant
            // -- while the driver's size() also counts delayed and reserved
            // ones, so taking whichever happened to be present made the column
            // silently change meaning when Horizon restarted. Report both:
            // `depth` is everything on the lane, `ready` is what a worker could
            // pick up right now, and the gap between them is work that is
            // either in flight or not due yet.
            $depth = $this->depthFromDriver($lane, $queue);
            $ready = $entry['length'] ?? null;
            $totalDepth += max(0, (int) $depth);

            $metrics = $this->windowed('queue', $queue, true);

            // Milliseconds to drain what is queued, before priority ordering
            // and process count are applied. Null means *unknowable*, not zero:
            // a lane holding work with no runtime sample yet cannot be
            // estimated, and reporting 0s there is precisely how the previous
            // figure hid real backlogs.
            $pending = max(0, (int) ($ready ?? $depth));
            $clearMs[$queue] = match (true) {
                $pending === 0 => 0.0,
                $metrics['avgRuntimeMs'] === null => null,
                default => $pending * (float) $metrics['avgRuntimeMs'],
            };

            $meta = $this->catalogue->describeLane($lane);

            $lanes[] = [
                'lane' => $lane,
                // What the lane is for. A key on its own does not tell an
                // operator why `mods` is allowed to be an hour behind.
                'title' => $meta['title'],
                'summary' => $meta['summary'],
                'queue' => $queue,
                'connection' => $this->topology->resolvedConnectionFor($lane),
                'long' => $this->topology->isLong($lane),
                'retryAfter' => $this->topology->retryAfterFor($lane),
                'expected' => $this->topology->isExpected($lane),
                'consumed' => in_array($queue, $consumed, true),
                'depth' => $depth,
                'ready' => $ready,
                'processes' => $entry['processes'] ?? null,
                'waitThresholdSeconds' => $this->waits->thresholdFor($lane, $queue),
                ...$metrics,
            ];
        }

        $waits = $this->waits->estimate($clearMs, $supervisors);

        foreach ($lanes as $index => $lane) {
            $lanes[$index]['waitSeconds'] = $waits[$lane['queue']] ?? null;
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
                'supervisors' => $supervisors,
            ],
            // How far back the throughput figures reach, so the page can label
            // them rather than implying they are all-time totals.
            'metricsWindowMinutes' => collect($lanes)->pluck('windowMinutes')->filter()->max(),
            'defaultConnection' => $this->topology->defaultConnection(),
            'longConnection' => $this->topology->longConnection(),
            'totalDepth' => $totalDepth,
            'lanes' => $lanes,
            'jobs' => $this->jobMetrics(),
            'workers' => $workers,
            // The same processes, grouped under the supervisor that owns them.
            // `workers` stays for anything reading the flat list.
            'pools' => $this->pools($supervisors, $workers),
            'failed' => $this->failedJobs(),
            // Cron, which is upstream of everything here. A panel whose
            // scheduler has stopped looks perfectly healthy from the queue
            // alone: lanes clear, workers green, nothing being fed to them.
            'scheduler' => $scheduler,
            'warnings' => $this->warnings($lanes, $masters, $scheduler),
        ];
    }

    /**
     * What an operator should act on, worst first.
     *
     * @param list<array<string, mixed>> $lanes
     * @param list<array<string, mixed>> $masters
     * @param array<string, mixed> $scheduler
     *
     * @return list<array{code: string, severity: string, message: string}>
     */
    private function warnings(array $lanes, array $masters, array $scheduler): array
    {
        $warnings = [];

        foreach ($this->schedulerWarnings($scheduler) as $warning) {
            $warnings[] = $warning;
        }

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
            if (!$lane['expected']) {
                continue;
            }

            if (!$lane['consumed']) {
                $warnings[] = [
                    'code' => 'lane_without_consumer',
                    'severity' => ((int) $lane['depth']) > 0 ? 'critical' : 'warning',
                    'message' => ((int) $lane['depth']) > 0
                        ? "The [{$lane['lane']}] queue has {$lane['depth']} job(s) waiting and no worker consuming it."
                        : "No worker is consuming the [{$lane['lane']}] queue. Work routed there would never run.",
                ];

                continue;
            }

            // A lane can have a live worker and still be losing ground, which
            // queue depth alone does not say -- ten jobs is nothing on `mail`
            // and a serious backlog on `mods`. `horizon.waits` already carries a
            // per-lane target for exactly this, and it is only a warning: a busy
            // lane is not a broken one, and must not fail a monitoring check.
            if ($lane['waitThresholdSeconds'] === null || $lane['waitSeconds'] === null) {
                continue;
            }

            if ($lane['waitSeconds'] > $lane['waitThresholdSeconds']) {
                $warnings[] = [
                    'code' => 'lane_backing_up',
                    'severity' => 'warning',
                    'message' => "The [{$lane['lane']}] queue needs an estimated {$lane['waitSeconds']}s to clear, past its {$lane['waitThresholdSeconds']}s target. Work routed there is being delayed.",
                ];
            }
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
     * Worker processes grouped under the supervisor that owns them.
     *
     * The flat list this replaces was the single most confusing thing on the
     * page: six rows of `host:pid` look like six separate problems, when they
     * are one healthy supervisor running six processes. Horizon knows the
     * supervisors and the heartbeat knows the live processes; neither alone can
     * draw the tree, so it is assembled here.
     *
     * Processes that match no configured supervisor are not dropped. A hand
     * started `queue:work` is exactly the kind of thing an operator needs to
     * find out about, so it lands in its own group rather than vanishing.
     *
     * @param list<array<string, mixed>> $supervisors
     * @param list<array<string, mixed>> $workers
     *
     * @return list<array<string, mixed>>
     */
    private function pools(array $supervisors, array $workers): array
    {
        $meta = (array) config('queue.supervisor_meta', []);
        $pools = [];
        $claimed = [];

        foreach ($this->topology->horizonSupervisors() as $name => $definition) {
            $queues = $definition['queue'];

            // Horizon prefixes supervisor names with the master's hostname, so
            // match on the configured name as a suffix rather than exactly.
            $reported = collect($supervisors)->first(
                fn (array $supervisor) => is_string($supervisor['name'] ?? null)
                    && str_ends_with($supervisor['name'], $name)
            );

            $processes = [];

            foreach ($workers as $index => $worker) {
                if (isset($claimed[$index]) || array_intersect($worker['queues'] ?? [], $queues) === []) {
                    continue;
                }

                // A lane name can appear under two supervisors only if the
                // connections differ, so the connection settles the tie.
                if (($worker['connection'] ?? null) !== null
                    && $worker['connection'] !== $definition['connection']) {
                    continue;
                }

                $claimed[$index] = true;
                $processes[] = $this->presentProcess($worker);
            }

            $lanes = array_values(array_filter(array_map(
                fn (string $queue) => $this->topology->laneForQueue($queue),
                $queues
            )));

            $pools[] = [
                'name' => $name,
                'title' => (string) ($meta[$name]['title'] ?? $name),
                'summary' => isset($meta[$name]['summary']) ? (string) $meta[$name]['summary'] : null,
                'connection' => $definition['connection'],
                'queues' => array_values($queues),
                'lanes' => $lanes,
                'status' => $reported['status'] ?? null,
                // Whether this supervisor is *meant* to be staffed right now.
                // A pool sized to zero because its module is off is correct,
                // not broken, and must not be drawn as an outage.
                'expected' => $lanes === [] || collect($lanes)->contains(fn (string $lane) => $this->topology->isExpected($lane)),
                'configuredProcesses' => $reported['processes'] ?? null,
                'maxProcesses' => $this->configuredProcessCeiling($name),
                'processes' => $processes,
                'processCount' => count($processes),
                'busyCount' => count(array_filter($processes, fn (array $process) => $process['job'] !== null)),
            ];
        }

        $orphans = array_values(array_map(
            fn (array $worker) => $this->presentProcess($worker),
            array_values(array_diff_key($workers, $claimed))
        ));

        if ($orphans !== []) {
            $pools[] = [
                'name' => 'unmanaged',
                'title' => 'Unmanaged workers',
                'summary' => 'Processes draining a queue outside the configured supervisors, such as a hand-started queue:work.',
                'connection' => null,
                'queues' => array_values(array_unique(array_merge(...array_map(
                    fn (array $process) => $process['queues'],
                    $orphans
                )))),
                'lanes' => [],
                'status' => null,
                'expected' => false,
                'configuredProcesses' => null,
                'maxProcesses' => null,
                'processes' => $orphans,
                'processCount' => count($orphans),
                'busyCount' => count(array_filter($orphans, fn (array $process) => $process['job'] !== null)),
            ];
        }

        return $pools;
    }

    /**
     * One worker process, with its current job named rather than left as a
     * class -- and with how long it has been on it, which is the difference
     * between a healthy long install and a wedged process.
     *
     * @param array<string, mixed> $worker
     *
     * @return array<string, mixed>
     */
    private function presentProcess(array $worker): array
    {
        $job = isset($worker['job']) && is_string($worker['job']) ? $worker['job'] : null;
        $startedAt = isset($worker['jobStartedAt']) && is_string($worker['jobStartedAt'])
            ? $worker['jobStartedAt']
            : null;

        $busySeconds = null;

        if ($startedAt !== null) {
            try {
                $busySeconds = max(0, now()->diffInSeconds(Carbon::parse($startedAt), true));
            } catch (\Throwable) {
                $busySeconds = null;
            }
        }

        return [
            'host' => $worker['host'] ?? 'unknown',
            'pid' => $worker['pid'] ?? null,
            'connection' => $worker['connection'] ?? null,
            'queues' => $worker['queues'] ?? [],
            'seenAt' => $worker['seenAt'] ?? null,
            'job' => $job,
            'jobTitle' => $job === null ? null : $this->catalogue->describe($job)['title'],
            'jobStartedAt' => $startedAt,
            'busySeconds' => $busySeconds === null ? null : (int) $busySeconds,
        ];
    }

    /**
     * The ceiling Horizon was configured with, so the page can show "3 of 6"
     * rather than an unanchored process count. `maxProcesses` is only set on
     * balanced supervisors; the fixed ones carry `processes` instead.
     */
    private function configuredProcessCeiling(string $supervisor): ?int
    {
        $defaults = (array) config('horizon.defaults.' . $supervisor, []);
        $ceiling = $defaults['maxProcesses'] ?? $defaults['processes'] ?? null;

        return is_numeric($ceiling) ? (int) $ceiling : null;
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
                        $byQueue[$part['name']] = $part + ['processes' => $entry['processes']];
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
                    // Horizon measures by class. Name it, so the busiest-jobs
                    // list is readable without decoding a namespace per row.
                    ...collect($this->catalogue->describe((string) $job))
                        ->only(['key', 'title', 'summary', 'lane', 'known'])
                        ->all(),
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
     * Horizon's live counters cannot be read alone: `horizon:snapshot` rolls them
     * into a time series every five minutes and *deletes* them on the way past,
     * so reading them directly shows a number that keeps collapsing to zero. So
     * the retained snapshots are summed with the live counter added on top.
     * Runtime is weighted by throughput — a straight mean would let one idle
     * window count as much as a busy one.
     *
     * These reads hit Redis and can fail independently, so a missing number must
     * not cost the whole page. `$withSeries` returns the same snapshots as a
     * plain time series, since they are fetched either way.
     *
     * @return array{processed: ?int, avgRuntimeMs: ?float, windowMinutes: ?int, series?: list<array{time: int, throughput: int, runtimeMs: float}>}
     */
    private function windowed(string $type, string $name, bool $withSeries = false): array
    {
        try {
            $metrics = app(MetricsRepository::class);

            $snapshots = $type === 'queue' ? $metrics->snapshotsForQueue($name) : $metrics->snapshotsForJob($name);
            $processed = (int) ($type === 'queue' ? $metrics->throughputForQueue($name) : $metrics->throughputForJob($name));
            $runtimeSum = (float) ($type === 'queue' ? $metrics->runtimeForQueue($name) : $metrics->runtimeForJob($name)) * $processed;
        } catch (\Throwable $e) {
            Log::debug('QueueHealthService: could not read Horizon metrics', ['name' => $name, 'error' => $e->getMessage()]);

            return ['processed' => null, 'avgRuntimeMs' => null, 'windowMinutes' => null] + ($withSeries ? ['series' => []] : []);
        }

        $earliest = null;
        $series = [];

        foreach ($snapshots as $snapshot) {
            $count = (int) ($snapshot->throughput ?? 0);
            $processed += $count;
            $runtimeSum += (float) ($snapshot->runtime ?? 0) * $count;

            $time = (int) ($snapshot->time ?? 0);

            if ($time > 0 && ($earliest === null || $time < $earliest)) {
                $earliest = $time;
            }

            $series[] = [
                'time' => $time,
                'throughput' => $count,
                'runtimeMs' => round((float) ($snapshot->runtime ?? 0), 2),
            ];
        }

        usort($series, fn (array $a, array $b) => $a['time'] <=> $b['time']);

        return [
            'processed' => $processed,
            'avgRuntimeMs' => $processed > 0 ? round($runtimeSum / $processed, 2) : null,
            'windowMinutes' => $earliest === null ? null : max(1, (int) round((time() - $earliest) / 60)),
        ] + ($withSeries ? ['series' => $series] : []);
    }

    /**
     * Whether cron is still calling the scheduler.
     *
     * Reported alongside the queue warnings rather than on a page of its own:
     * an operator asking "is the panel healthy" is asking one question, and the
     * answer has two halves that fail independently. A stopped cron produces no
     * queue symptom whatsoever -- lanes stay clear and workers stay green,
     * because nothing is being dispatched to them.
     *
     * "Never seen" is kept separate from "stale". A panel that started a minute
     * ago has no heartbeat yet and that is not evidence of a missing cron entry,
     * so it names the entry to add instead of reporting an outage.
     *
     * @param array<string, mixed> $scheduler
     *
     * @return list<array{code: string, severity: string, message: string}>
     */
    private function schedulerWarnings(array $scheduler): array
    {
        $seconds = (int) ($scheduler['secondsAgo'] ?? 0);

        return match ($scheduler['severity'] ?? 'unknown') {
            'unknown' => [[
                'code' => 'scheduler_never_seen',
                'severity' => 'warning',
                'message' => 'The task scheduler has not run since this panel started. If that does not change within a minute, add the cron entry: * * * * * php artisan schedule:run >> /dev/null 2>&1',
            ]],
            'down' => [[
                'code' => 'scheduler_down',
                'severity' => 'critical',
                'message' => sprintf(
                    'The task scheduler last ran %s ago. Scheduled work — server schedules, billing renewals, pruning — is not running. Check the cron entry: * * * * * php artisan schedule:run',
                    $this->humanSeconds($seconds),
                ),
            ]],
            'stale' => [[
                'code' => 'scheduler_stale',
                'severity' => 'warning',
                'message' => sprintf('The task scheduler last ran %s ago; it should run every minute.', $this->humanSeconds($seconds)),
            ]],
            default => [],
        };
    }

    private function humanSeconds(int $seconds): string
    {
        if ($seconds < 120) {
            return $seconds . ' seconds';
        }

        return $seconds < 7200
            ? intdiv($seconds, 60) . ' minutes'
            : intdiv($seconds, 3600) . ' hours';
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
