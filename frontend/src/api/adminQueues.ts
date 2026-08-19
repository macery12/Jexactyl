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
    job: string;
    processed: number | null;
    avgRuntimeMs: number | null;
    windowMinutes: number | null;
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
    workers: QueueWorker[];
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
    /** Full stack trace, present only when a single job is fetched. */
    exception?: string;
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
