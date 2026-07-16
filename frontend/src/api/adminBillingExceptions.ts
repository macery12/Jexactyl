import http from '@/lib/http';

// Admin billing exceptions — the operational error log for billing flows
// (deployment/payment/storefront/webhook/refund/validation). Resolve removes
// an entry. Backed by existing /api/application/billing/exceptions. No backend
// changes.

export type BillingExceptionType =
    | 'deployment'
    | 'payment'
    | 'storefront'
    | 'webhook'
    | 'refund'
    | 'validation'
    | string;

export interface BillingException {
    id: number;
    uuid: string;
    title: string;
    description: string;
    exceptionType: BillingExceptionType;
    orderId: number | null;
    createdAt: string;
}

export interface Pagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

function toException(row: any): BillingException {
    const a = row.attributes ?? row;
    return {
        id: a.id,
        uuid: a.uuid,
        title: a.title,
        description: a.description ?? '',
        exceptionType: a.exception_type,
        orderId: a.order_id ?? null,
        createdAt: a.created_at,
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

export async function getBillingExceptions(
    page: number,
    search: string | null,
    perPage = 20,
): Promise<{ items: BillingException[]; pagination: Pagination }> {
    const params: Record<string, unknown> = { page, per_page: perPage };
    if (search && search.length >= 2) params['filter[title]'] = search;
    const { data } = await http.get('/api/application/billing/exceptions', { params });
    return { items: (data.data ?? []).map(toException), pagination: pagination(data.meta, perPage) };
}

export async function resolveBillingException(uuid: string): Promise<void> {
    await http.delete(`/api/application/billing/exceptions/${uuid}`);
}

export async function resolveAllBillingExceptions(): Promise<void> {
    await http.delete('/api/application/billing/exceptions');
}
