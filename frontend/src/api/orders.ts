import http from '@/lib/http';

// Account billing history — orders + invoices, backed by the existing V1
// client endpoints (/api/client/billing/orders, /api/client/billing/invoices),
// both gated behind the `orders` view permission. No backend changes.

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

export interface Order {
    id: number;
    name: string;
    description: string;
    total: number;
    subtotal: number | null;
    discount: number | null;
    productId: number;
    productName: string | null;
    status: OrderStatus;
    type: OrderType;
    paymentProcessor: PaymentProcessor;
    billingDays: number | null;
    serverName: string | null;
    transaction: OrderTransaction | null;
    createdAt: string;
    updatedAt: string | null;
}

export interface OrderFilters {
    paymentProcessor?: PaymentProcessor | null;
    status?: OrderStatus | null;
    type?: OrderType | null;
    minAmount?: number | null;
    maxAmount?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    search?: string | null;
}

export type OrderSort = 'id' | 'total' | 'created_at';

export interface Pagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface OrderPage {
    items: Order[];
    pagination: Pagination;
}

function toTransaction(t: any): OrderTransaction | null {
    if (!t) return null;
    return {
        externalId: t.external_id ?? null,
        captureId: t.capture_id ?? null,
        status: t.status ?? null,
        amount: t.amount ?? null,
        currency: t.currency ?? null,
        payerId: t.payer_id ?? null,
        payerEmail: t.payer_email ?? null,
        capturedAt: t.captured_at ?? null,
    };
}

function toOrder(row: { attributes: Record<string, any> }): Order {
    const a = row.attributes;
    return {
        id: a.id,
        name: a.name ?? '',
        description: a.description ?? '',
        total: Number(a.total ?? 0),
        subtotal: a.subtotal != null ? Number(a.subtotal) : null,
        discount: a.discount != null ? Number(a.discount) : null,
        productId: a.product_id,
        productName: a.product_name ?? null,
        status: a.status,
        type: a.type,
        paymentProcessor: a.payment_processor,
        billingDays: a.billing_days ?? null,
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

// GET /api/client/billing/orders — filterable, sortable, paginated order list.
export async function getOrders(
    page: number,
    filters: OrderFilters,
    sort: OrderSort,
    sortDesc: boolean,
    perPage = 20,
): Promise<OrderPage> {
    const params: Record<string, unknown> = {
        page,
        per_page: perPage,
        sort: `${sortDesc ? '-' : ''}${sort}`,
    };
    if (filters.paymentProcessor) params['filter[payment_processor]'] = filters.paymentProcessor;
    if (filters.status) params['filter[status]'] = filters.status;
    if (filters.type) params['filter[type]'] = filters.type;
    if (filters.minAmount != null) params['filter[min_amount]'] = filters.minAmount;
    if (filters.maxAmount != null) params['filter[max_amount]'] = filters.maxAmount;
    if (filters.startDate) params['filter[start_date]'] = filters.startDate;
    if (filters.endDate) params['filter[end_date]'] = filters.endDate;
    if (filters.search && filters.search.length >= 2) params['filter[search]'] = filters.search;

    const { data } = await http.get('/api/client/billing/orders', { params });
    return {
        items: (data.data ?? []).map(toOrder),
        pagination: pagination(data.meta, perPage),
    };
}

// GET /api/client/billing/orders/{id} — single order (with transaction).
export async function getOrder(id: number): Promise<Order> {
    const { data } = await http.get(`/api/client/billing/orders/${id}`);
    return toOrder(data);
}

// ---- invoices ---------------------------------------------------------------

export type InvoiceStatus = 'active' | 'expired' | 'void';

export interface Invoice {
    uuid: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    total: number; // major currency units (for example, 4.00 USD)
    currency: string;
    generatedAt: string | null;
    orderType: string | null;
    isDownloadable: boolean;
}

function toInvoice(row: { attributes: Record<string, any> }): Invoice {
    const a = row.attributes;
    return {
        uuid: a.uuid,
        invoiceNumber: a.invoice_number,
        status: a.status,
        total: Number(a.total ?? 0),
        currency: a.currency ?? 'USD',
        generatedAt: a.generated_at ?? null,
        orderType: a.order_type ?? null,
        isDownloadable: Boolean(a.is_downloadable),
    };
}

// GET /api/client/billing/invoices — paginated invoice list.
export async function getInvoices(page: number, perPage = 20): Promise<{ items: Invoice[]; pagination: Pagination }> {
    const { data } = await http.get('/api/client/billing/invoices', { params: { page, per_page: perPage } });
    return {
        items: (data.data ?? []).map(toInvoice),
        pagination: pagination(data.meta, perPage),
    };
}

// GET /api/client/billing/invoices/{uuid}/download — returns a signed URL to
// the rendered PDF, which we open in a new tab.
export async function getInvoiceDownloadUrl(uuid: string): Promise<string> {
    const { data } = await http.get(`/api/client/billing/invoices/${uuid}/download`);
    return data.url as string;
}
