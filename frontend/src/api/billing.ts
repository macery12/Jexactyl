import http from '@/lib/http';

// Admin billing analytics — the overview dashboard. Sourced from
// GET /api/application/billing/analytics (BillingController::buildAnalytics).
// The endpoint returns raw Eloquent models for categories/products/orders, so
// those keys are snake_case; the assembled blocks (forecast, renewals, etc.)
// are already shaped by the controller.

export interface RenewalWindow {
    count: number;
    expectedRevenue: number;
}

export interface RecentEvent {
    id: number;
    date: string;
    type: string;
    status: string;
    paymentProcessor: string | null;
    total: number;
    serverId: number | null;
    serverUuid: string | null;
    serverName: string | null;
}

export interface SuspendedServer {
    id: number;
    uuid: string;
    name: string;
    owner: string;
    ownerEmail: string | null;
}

export interface MonthPoint {
    key: string; // YYYY-MM
    label: string; // e.g. "Jun"
    revenue: number; // sum of processed-order totals that month
    orders: number; // all orders that month
}

export interface StatusSlice {
    status: string;
    count: number;
}

export interface BillingAnalytics {
    productCount: number;
    categoryCount: number;
    forecast: { next7Days: number; next30Days: number };
    upcomingRenewals: {
        overdue: RenewalWindow;
        in7Days: RenewalWindow;
        in8to14Days: RenewalWindow;
        total14Days: RenewalWindow;
    };
    suspendedServers: SuspendedServer[];
    recentEvents: RecentEvent[];
    // Total realised revenue across the orders returned in the last-year window.
    ordersTotal: number;
    orderCount: number;
    // Derived chart series.
    monthlyRevenue: MonthPoint[];
    statusBreakdown: StatusSlice[];
}

// Bucket the last-year order list into the trailing 12 calendar months and a
// status tally, so the overview can render trend + composition charts without
// any extra endpoint.
function buildSeries(orders: any[]): { monthlyRevenue: MonthPoint[]; statusBreakdown: StatusSlice[] } {
    const months: MonthPoint[] = [];
    const index = new Map<string, MonthPoint>();
    const now = new Date();
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const point: MonthPoint = { key, label: fmt.format(d), revenue: 0, orders: 0 };
        months.push(point);
        index.set(key, point);
    }

    const status = new Map<string, number>();
    for (const o of orders) {
        const d = new Date(o.created_at);
        if (Number.isNaN(d.getTime())) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const point = index.get(key);
        if (point) {
            point.orders += 1;
            if (o.status === 'processed') point.revenue += Number(o.total ?? 0);
        }
        const s = o.status ?? 'unknown';
        status.set(s, (status.get(s) ?? 0) + 1);
    }

    const statusBreakdown = [...status.entries()]
        .map(([s, count]) => ({ status: s, count }))
        .sort((a, b) => b.count - a.count);

    return { monthlyRevenue: months, statusBreakdown };
}

function toWindow(w: any): RenewalWindow {
    return {
        count: Number(w?.count ?? 0),
        expectedRevenue: Number(w?.expectedRevenue ?? 0),
    };
}

export async function getBillingAnalytics(): Promise<BillingAnalytics> {
    const { data } = await http.get('/api/application/billing/analytics');

    const orders: any[] = data.orders ?? [];
    const ordersTotal = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
    const { monthlyRevenue, statusBreakdown } = buildSeries(orders);

    return {
        productCount: (data.products ?? []).length,
        categoryCount: (data.categories ?? []).length,
        forecast: {
            next7Days: Number(data.forecast?.next7Days ?? 0),
            next30Days: Number(data.forecast?.next30Days ?? 0),
        },
        upcomingRenewals: {
            overdue: toWindow(data.upcomingRenewals?.overdue),
            in7Days: toWindow(data.upcomingRenewals?.in7Days),
            in8to14Days: toWindow(data.upcomingRenewals?.in8to14Days),
            total14Days: toWindow(data.upcomingRenewals?.total14Days),
        },
        suspendedServers: (data.suspendedServers ?? []).map((s: any) => ({
            id: s.id,
            uuid: s.uuid,
            name: s.name,
            owner: s.owner,
            ownerEmail: s.owner_email ?? null,
        })),
        recentEvents: (data.recentEvents ?? []).map((e: any) => ({
            id: e.id,
            date: e.date,
            type: e.type,
            status: e.status,
            paymentProcessor: e.payment_processor ?? null,
            total: Number(e.total ?? 0),
            serverId: e.server_id ?? null,
            serverUuid: e.server_uuid ?? null,
            serverName: e.server_name ?? null,
        })),
        ordersTotal,
        orderCount: orders.length,
        monthlyRevenue,
        statusBreakdown,
    };
}
