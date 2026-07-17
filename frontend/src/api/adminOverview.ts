import http from '@/lib/http';

// Admin overview aggregate — one cheap, DB-only snapshot driving the /admin
// dashboard (GET /api/application/overview). Unlike most admin modules this hits a
// bespoke aggregate route rather than a Fractal collection, so the payload is a
// plain object and maps straight through. Supersedes the legacy /overview/metrics
// and /overview/version calls. Safe to poll on an interval — every field is a
// count or summed column.

export interface OverviewVersion {
    current: string;
    /** Latest published release tag, or null when no release exists / the feed is unreachable. */
    latest: string | null;
    /** Quietly true when there is nothing comparable to check against. */
    isLatest: boolean;
}

export interface OverviewNodeResource {
    /** Allocated across servers, in MiB. */
    used: number;
    /** Physical node capacity, in MiB. */
    total: number;
    /** used / total, in percent. Can exceed 100 (and limitPercent) under overallocation. */
    percent: number;
    /** Configured overallocation ceiling vs physical capacity (150 = 50% over); null = unlimited. */
    limitPercent: number | null;
}

export interface OverviewNode {
    id: number;
    name: string;
    maintenance: boolean;
    servers: number;
    memory: OverviewNodeResource;
    disk: OverviewNodeResource;
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
        list: OverviewNode[];
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
