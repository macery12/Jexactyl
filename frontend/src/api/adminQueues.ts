import http from '@/lib/http';

// Worker-queue health (GET /api/application/queues).
//
// Distinct from AdminOverview's `queues`, which reports business backlog --
// open tickets, billing exceptions. This is the infrastructure view: what is
// queued, what is draining it, and what is wrong with the setup.
//
// The server caches this snapshot for a few seconds and shares it between
// callers, so it is safe to poll.

/** Something an operator has to act on. `critical` means work is not running. */
export interface QueueWarning {
    code: string;
    severity: 'critical' | 'warning';
    message: string;
}

export interface QueueLane {
    /** Stable key from config/queue.php, e.g. `mail`. */
    lane: string;
    /** What the lane carries, in an operator's words -- "Modpack installs". */
    title: string;
    /** One sentence on why the lane exists. Null for a lane with no configured description. */
    summary: string | null;
    /** The queue name actually used on the driver, which operators can rename. */
    queue: string;
    connection: string;
    /** Long-running lanes carry a much larger retry_after; modpack installs live here. */
    long: boolean;
    retryAfter: number | null;
    /** False when the lane's module is switched off, so an idle lane is correct rather than broken. */
    expected: boolean;
    /** Whether a live worker process is draining this lane right now. */
    consumed: boolean;
    /** Everything on the lane -- ready, delayed and in flight. Null when the driver could not be reached. */
    depth: number | null;
    /** The subset a worker could pick up this second. Null while Horizon is down. */
    ready: number | null;
    /**
     * Estimated seconds to clear, cumulative over higher-priority lanes on the
     * same supervisor. Null means unknowable (work queued, no runtime sample yet)
     * rather than instant.
     */
    waitSeconds: number | null;
    /** The lane's target from config/horizon.php; exceeding it raises a warning. */
    waitThresholdSeconds: number | null;
    processes: number | null;
    /** Jobs completed across the retained metrics window, not an all-time total. */
    processed: number | null;
    avgRuntimeMs: number | null;
    windowMinutes: number | null;
    /** Retained five-minute snapshots, oldest first, for the trend sparkline. */
    series: QueueSnapshot[];
}

/** One retained metrics snapshot. Horizon writes these every five minutes. */
export interface QueueSnapshot {
    /** Unix seconds. */
    time: number;
    throughput: number;
    runtimeMs: number;
}

export interface QueueJobMetric {
    /** The job class, which is what Horizon measures and what the logs carry. */
    job: string;
    /** Stable slug, safe in a React key or a message id. */
    key: string;
    /** Human name from the catalogue, or a prettified class basename. */
    title: string;
    summary: string | null;
    lane: string | null;
    /** False when the class is not catalogued -- an extension's job, usually. */
    known: boolean;
    processed: number | null;
    avgRuntimeMs: number | null;
    windowMinutes: number | null;
}

/**
 * One live worker process, as reported by its own heartbeat.
 *
 * `job` is what it is running *right now*; null means idle. `busySeconds` is
 * how long it has been on that job, which is the difference between a healthy
 * hour-long modpack install and a wedged process.
 */
export interface QueueProcess {
    host: string;
    pid: number | null;
    connection: string | null;
    queues: string[];
    seenAt: string | null;
    job: string | null;
    jobTitle: string | null;
    jobStartedAt: string | null;
    busySeconds: number | null;
}

/**
 * A Horizon supervisor and the processes it owns.
 *
 * This is the grouping the flat worker list never had: six rows of host:pid
 * are one healthy supervisor, not six problems.
 */
export interface QueuePool {
    /** Supervisor name from config, or `unmanaged` for processes it does not own. */
    name: string;
    title: string;
    summary: string | null;
    connection: string | null;
    queues: string[];
    lanes: string[];
    /** Horizon's own status string, null when Horizon is not running. */
    status: string | null;
    /** False when the pool is correctly unstaffed because its module is off. */
    expected: boolean;
    configuredProcesses: number | null;
    /** The ceiling from config/horizon.php, so a count can read as "3 of 6". */
    maxProcesses: number | null;
    processes: QueueProcess[];
    processCount: number;
    busyCount: number;
}

export interface QueueWorker {
    host: string;
    pid: number | null;
    connection: string | null;
    queues: string[];
    seenAt: string;
}

export interface QueueSupervisor {
    name: string | null;
    status: string | null;
    processes: number;
    queues: string[];
}

/**
 * The Laravel scheduler, which is upstream of the whole queue.
 *
 * Reported here because a stopped cron produces no queue symptom at all: every
 * lane stays clear and every worker stays green, because nothing is being
 * dispatched to them. `severity` is judged on the server so the page and the
 * warning list cannot disagree about what counts as stale.
 */
export interface QueueScheduler {
    /** When `schedule:run` last started. Null means it has not since boot. */
    ranAt: string | null;
    secondsAgo: number | null;
    host: string | null;
    pid: number | null;
    /** `unknown` is "never seen", which is not the same as stale. */
    severity: 'ok' | 'stale' | 'down' | 'unknown';
    staleAfterSeconds: number;
    /** Newest first, one entry per task -- the only view of work that runs inline. */
    recent: { task: string; ranAt: string; runtimeMs: number | null; ok: boolean }[];
    lastFailure: { task: string; ranAt: string; error: string } | null;
}

export interface QueueHealth {
    generatedAt: string;
    environment: {
        /** False when this install cannot run the queue worker at all. */
        supported: boolean;
        problems: { code: string; problem: string; fix: string }[];
    };
    horizon: {
        running: boolean;
        paused: boolean;
        masters: { name: string | null; status: string | null; pid: number | null }[];
        supervisors: QueueSupervisor[];
    };
    /** How far back the `processed`/`avgRuntimeMs` figures reach. Null when nothing has run yet. */
    metricsWindowMinutes: number | null;
    defaultConnection: string;
    longConnection: string;
    totalDepth: number;
    lanes: QueueLane[];
    jobs: QueueJobMetric[];
    /** Flat list of live processes. Prefer `pools`, which groups them. */
    workers: QueueWorker[];
    pools: QueuePool[];
    scheduler: QueueScheduler;
    failed: {
        total: number | null;
        lastDay: number | null;
        oldestFailedAt: string | null;
    };
    warnings: QueueWarning[];
}

export async function getQueueHealth(): Promise<QueueHealth> {
    const { data } = await http.get<QueueHealth>('/api/application/queues');
    return data;
}

/**
 * One entry in the failed-job list. Read from the `failed_jobs` table rather
 * than Horizon, so it survives a Redis flush.
 */
export interface FailedJob {
    uuid: string;
    /** The worker's own display name for the job, so it matches the logs. */
    job: string;
    connection: string;
    queue: string;
    /** Null when the job failed on a queue the panel no longer routes to. */
    lane: string | null;
    attempts: number | null;
    failedAt: string | null;
    exceptionClass: string | null;
    exceptionMessage: string;
    /** Human name from the catalogue; the class stays on `job`. */
    title: string;
    /** What running this job does -- read before pressing Retry. */
    summary: string | null;
    /** Full stack trace, present only when a single job is fetched. */
    exception?: string;
    /** Redacted payload, present only when a single job is fetched. */
    payload?: Record<string, unknown>;
}

export interface FailedJobPage {
    items: FailedJob[];
    total: number;
    page: number;
    perPage: number;
    /** The queues actually represented in the table, for the filter. */
    queues: string[];
}

export async function getFailedJobs(params: { page?: number; queue?: string | null } = {}): Promise<FailedJobPage> {
    const { data } = await http.get<FailedJobPage>('/api/application/queues/failed', {
        params: { page: params.page ?? 1, queue: params.queue || undefined },
    });
    return data;
}

export async function getFailedJob(uuid: string): Promise<FailedJob> {
    const { data } = await http.get<FailedJob>(`/api/application/queues/failed/${uuid}`);
    return data;
}

/** Pushes the job back onto its original queue and deletes the failed record. */
export async function retryFailedJob(uuid: string): Promise<void> {
    await http.post(`/api/application/queues/failed/${uuid}/retry`);
}

/** Pushes a selection back onto their queues. Returns how many actually went. */
export async function retryFailedJobs(uuids: string[]): Promise<{ retried: number; requested: number }> {
    const { data } = await http.post<{ retried: number; requested: number }>('/api/application/queues/failed/retry', {
        uuids,
    });
    return data;
}

/**
 * Discards one failure. Unrecoverable -- the row is the only copy of the
 * payload, so the caller must confirm first.
 */
export async function deleteFailedJob(uuid: string): Promise<void> {
    await http.delete(`/api/application/queues/failed/${uuid}`);
}

/** Discards a selection. Same warning as above, times the selection. */
export async function deleteFailedJobs(uuids: string[]): Promise<{ deleted: number; requested: number }> {
    const { data } = await http.delete<{ deleted: number; requested: number }>('/api/application/queues/failed', {
        data: { uuids },
    });
    return data;
}

/**
 * A scoped sweep. One of `queue` or `olderThanDays` must be present -- the API
 * refuses an unscoped call rather than treating it as "delete everything".
 */
export interface SweepScope {
    queue?: string | null;
    olderThanDays?: number | null;
}

/**
 * `remaining` is what the scope still matches afterwards. One sweep takes at
 * most a fixed number of rows, so that a request cannot walk an unbounded table
 * and die part-way through; a wider scope leaves a remainder rather than
 * silently reporting the lane clear.
 */
export async function sweepFailedJobs(scope: SweepScope): Promise<{ deleted: number; remaining: number }> {
    const { data } = await http.delete<{ deleted: number; remaining: number }>('/api/application/queues/failed', {
        data: scope,
    });
    return data;
}

/**
 * How many rows a sweep would take, so a confirmation can name the number, and
 * the per-request cap so it can say when more than one pass will be needed.
 * Refuses an unscoped call, exactly as the sweep itself does.
 */
export async function previewSweep(scope: SweepScope): Promise<{ count: number; cap: number }> {
    const { data } = await http.post<{ count: number; cap: number }>(
        '/api/application/queues/failed/sweep-preview',
        scope,
    );
    return data;
}
