import http from '@/lib/http';

// Admin billing orders — the staff-facing order ledger, backed by the existing
// V1 endpoints (GET /api/application/billing/orders + /{id}/threat). No backend
// changes. Mirrors the account-side orders.ts transformer but surfaces the
// admin-only fields (customer identity, threat index, transaction lookup).

export type OrderStatus = 'pending' | 'expired' | 'failed' | 'cancelled' | 'processed';
export type OrderType = 'new' | 'upg' | 'ren';
export type PaymentProcessor = 'stripe' | 'paypal' | 'free';

export interface OrderTransaction {
    externalId: string | null;
    captureId: string | null;
    status: string | null;
    amount: number | null;
    currency: string | null;
    payerId: string | null;
    payerEmail: string | null;
    capturedAt: string | null;
}

export interface AdminOrder {
    id: number;
    name: string;
    description: string;
    userId: number | null;
    username: string | null;
    userEmail: string | null;
    total: number;
    subtotal: number | null;
    discount: number | null;
    productId: number | null;
    productName: string | null;
    status: OrderStatus;
    type: OrderType | string;
    paymentProcessor: PaymentProcessor;
    threatIndex: number;
    billingDays: number | null;
    serverId: number | null;
    serverName: string | null;
    transaction: OrderTransaction | null;
    createdAt: string;
    updatedAt: string | null;
}

// Prefix-aware smart-search filter (matches V1 #id/@user/txn:/cap:/pid:/pay:).
export interface AdminOrderFilters {
    // Partial match on the order name. Renewal orders carry the server's short
    // uuid in their name (ServerRenewalService), so this is how the admin server
    // editor scopes the ledger to one server — same as V1's OrdersTable.
    name?: string | null;
    paymentProcessor?: PaymentProcessor | null;
    status?: OrderStatus | null;
    type?: string | null;
    minAmount?: number | null;
    maxAmount?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    search?: string | null;
    transactionId?: string | null;
    captureId?: string | null;
    payerId?: string | null;
    payerEmail?: string | null;
}

export type AdminOrderSort = 'id' | 'total' | 'created_at';

export interface Pagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface AdminOrderPage {
    items: AdminOrder[];
    pagination: Pagination;
}

function toTransaction(t: any): OrderTransaction | null {
    if (!t) return null;
    return {
        externalId: t.external_id ?? null,
        captureId: t.capture_id ?? null,
        status: t.status ?? null,
        amount: t.amount != null ? Number(t.amount) : null,
        currency: t.currency ?? null,
        payerId: t.payer_id ?? null,
        payerEmail: t.payer_email ?? null,
        capturedAt: t.captured_at ?? null,
    };
}

function toOrder(row: { attributes: Record<string, any> }): AdminOrder {
    const a = row.attributes;
    return {
        id: a.id,
        name: a.name ?? '',
        description: a.description ?? '',
        userId: a.user_id ?? null,
        username: a.username ?? null,
        userEmail: a.user_email ?? null,
        total: Number(a.total ?? 0),
        subtotal: a.subtotal != null ? Number(a.subtotal) : null,
        discount: a.discount != null ? Number(a.discount) : null,
        productId: a.product_id ?? null,
        productName: a.product_name ?? null,
        status: a.status,
        type: a.type ?? '?',
        paymentProcessor: a.payment_processor,
        threatIndex: a.threat_index != null ? Number(a.threat_index) : -1,
        billingDays: a.billing_days ?? null,
        serverId: a.server_id ?? null,
        serverName: a.server_name ?? null,
        transaction: toTransaction(a.transaction),
        createdAt: a.created_at,
        updatedAt: a.updated_at ?? null,
    };
}

function pagination(meta: any, perPage: number): Pagination {
    const p = meta?.pagination ?? {};
    return {
        currentPage: p.current_page ?? 1,
        totalPages: p.total_pages ?? 1,
        total: p.total ?? 0,
        perPage: p.per_page ?? perPage,
    };
}

export async function getAdminOrders(
    page: number,
    filters: AdminOrderFilters,
    sort: AdminOrderSort,
    sortDesc: boolean,
    perPage = 20,
): Promise<AdminOrderPage> {
    const params: Record<string, unknown> = {
        page,
        per_page: perPage,
        sort: `${sortDesc ? '-' : ''}${sort}`,
    };
    if (filters.name) params['filter[name]'] = filters.name;
    if (filters.paymentProcessor) params['filter[payment_processor]'] = filters.paymentProcessor;
    if (filters.status) params['filter[status]'] = filters.status;
    if (filters.type) params['filter[type]'] = filters.type;
    if (filters.minAmount != null) params['filter[min_amount]'] = filters.minAmount;
    if (filters.maxAmount != null) params['filter[max_amount]'] = filters.maxAmount;
    if (filters.startDate) params['filter[start_date]'] = filters.startDate;
    if (filters.endDate) params['filter[end_date]'] = filters.endDate;
    if (filters.search && filters.search.length >= 2) params['filter[search]'] = filters.search;
    if (filters.transactionId) params['filter[transaction_id]'] = filters.transactionId;
    if (filters.captureId) params['filter[capture_id]'] = filters.captureId;
    if (filters.payerId) params['filter[payer_id]'] = filters.payerId;
    if (filters.payerEmail) params['filter[payer_email]'] = filters.payerEmail;

    const { data } = await http.get('/api/application/billing/orders', { params });
    return {
        items: (data.data ?? []).map(toOrder),
        pagination: pagination(data.meta, perPage),
    };
}

// --- threat breakdown ---------------------------------------------------------

export interface ThreatSignal {
    category: string;
    description: string;
    points: number;
    maxPoints: number;
    fired: boolean;
}

export interface ThreatBreakdown {
    score: number;
    signals: ThreatSignal[];
}

export async function getOrderThreat(orderId: number): Promise<ThreatBreakdown> {
    const { data } = await http.get(`/api/application/billing/orders/${orderId}/threat`);
    return {
        score: Number(data.score ?? 0),
        signals: (data.signals ?? []).map((s: any) => ({
            category: s.category,
            description: s.description,
            points: Number(s.points ?? 0),
            maxPoints: Number(s.max_points ?? 0),
            fired: Boolean(s.fired),
        })),
    };
}
