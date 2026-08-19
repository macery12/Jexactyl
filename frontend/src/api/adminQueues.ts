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
    /** Null when the driver could not be reached -- not the same as empty. */
    depth: number | null;
    waitSeconds: number | null;
    processes: number | null;
    /** Jobs completed across the retained metrics window, not an all-time total. */
    processed: number | null;
    avgRuntimeMs: number | null;
    windowMinutes: number | null;
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
