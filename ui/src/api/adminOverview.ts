import http from '@/lib/http';

// Admin overview aggregate — one cheap, DB-only snapshot driving the /v2/admin
// dashboard (GET /api/application/overview). Unlike most admin modules this hits a
// bespoke aggregate route rather than a Fractal collection, so the payload is a
// plain object and maps straight through. Supersedes the legacy /overview/metrics
// and /overview/version calls. Safe to poll on an interval — every field is a
// count or summed column.

export interface OverviewVersion {
    current: string;
    latest: string;
    isLatest: boolean;
}

export interface OverviewFleet {
    servers: {
        total: number;
        active: number;
        suspended: number;
        installFailed: number;
    };
    nodes: {
        total: number;
        maintenance: number;
    };
    capacity: {
        memoryUsed: number;
        memoryTotal: number;
        /** Allocated / capacity, in percent. Can exceed 100 under overallocation. */
        memoryPercent: number;
        diskUsed: number;
        diskTotal: number;
        diskPercent: number;
    };
}

export interface OverviewQueues {
    tickets: {
        pending: number;
        inProgress: number;
    };
    /** Billing exceptions raised in the last 7 days. */
    billingExceptions: number;
    /** Deferred emails still awaiting delivery. */
    deferredEmails: number;
}

export interface OverviewKpis {
    users: {
        total: number;
        newThisWeek: number;
    };
    revenue: {
        /** Monthly recurring revenue (daily billed amount × 30), matching Billing analytics. */
        monthlyRecurring: number;
    };
}

export interface OverviewActivityEntry {
    id: string;
    event: string;
    description: string | null;
    actor: string;
    timestamp: string;
}

export interface AdminOverview {
    health: {
        version: OverviewVersion;
    };
    fleet: OverviewFleet;
    queues: OverviewQueues;
    kpis: OverviewKpis;
    activity: OverviewActivityEntry[];
}

// GET /api/application/overview — full admin dashboard snapshot.
export async function getAdminOverview(): Promise<AdminOverview> {
    const { data } = await http.get<AdminOverview>('/api/application/overview');
    return data;
}
