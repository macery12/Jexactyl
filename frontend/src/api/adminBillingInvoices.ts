import http from '@/lib/http';

// Admin invoice management + invoice settings, backed by the existing V1
// endpoints under /api/application/billing/invoices and /invoice-settings.
// No backend changes.

export type AdminInvoiceStatus = 'active' | 'expired' | 'void';

export interface AdminInvoice {
    uuid: string;
    invoiceNumber: string;
    status: AdminInvoiceStatus;
    dataDisk: string | null;
    dataSizeBytes: number | null;
    hasCachedPdf: boolean;
    pdfExpiresAt: string | null;
    total: number; // minor units (cents)
    currency: string;
    generatedAt: string | null;
    expiresAt: string | null;
    voidedAt: string | null;
    voidedReason: string | null;
    orderId: number;
    user: { id: number; username: string; email: string } | null;
    isDownloadable: boolean;
}

export interface AdminInvoiceFilters {
    status?: string;
    search?: string;
}

export interface Pagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

function toInvoice(row: any): AdminInvoice {
    const a = row.attributes ?? row;
    return {
        uuid: a.uuid,
        invoiceNumber: a.invoice_number,
        status: a.status,
        dataDisk: a.data_disk ?? null,
        dataSizeBytes: a.data_size_bytes ?? null,
        hasCachedPdf: Boolean(a.has_cached_pdf),
        pdfExpiresAt: a.pdf_expires_at ?? null,
        total: Number(a.total ?? 0),
        currency: a.currency ?? 'USD',
        generatedAt: a.generated_at ?? null,
        expiresAt: a.expires_at ?? null,
        voidedAt: a.voided_at ?? null,
        voidedReason: a.voided_reason ?? null,
        orderId: a.order_id,
        user: a.user ?? null,
        isDownloadable: Boolean(a.is_downloadable),
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

export async function getAdminInvoices(
    page: number,
    filters: AdminInvoiceFilters,
    perPage = 20,
): Promise<{ items: AdminInvoice[]; pagination: Pagination }> {
    const params: Record<string, unknown> = { page, per_page: perPage };
    if (filters.status) params['filter[status]'] = filters.status;
    if (filters.search) params['filter[search]'] = filters.search;
    const { data } = await http.get('/api/application/billing/invoices', { params });
    return { items: (data.data ?? []).map(toInvoice), pagination: pagination(data.meta, perPage) };
}

export async function getAdminInvoiceDownloadUrl(uuid: string): Promise<string> {
    const { data } = await http.get(`/api/application/billing/invoices/${uuid}/download`);
    return data.url as string;
}

export async function voidInvoice(uuid: string, reason?: string): Promise<void> {
    await http.post(`/api/application/billing/invoices/${uuid}/void`, { reason });
}

export async function regenerateInvoice(uuid: string): Promise<void> {
    await http.post(`/api/application/billing/invoices/${uuid}/regenerate`);
}

export async function resendInvoiceEmail(uuid: string): Promise<void> {
    await http.post(`/api/application/billing/invoices/${uuid}/resend`);
}

// --- invoice settings ---------------------------------------------------------

export type StorageDriver = 'local' | 's3' | 'r2';

export interface InvoiceSettings {
    companyName: string;
    companyAddress: string;
    companyCity: string;
    companyState: string;
    companyZip: string;
    companyCountry: string;
    companyLogoUrl: string | null;
    companyTaxId: string | null;
    invoicePrefix: string;
    invoiceSequence: number;
    autoCleanupEnabled: boolean;
    autoCleanupAfterYears: number;
    requireBillingAddress: boolean;
    storageDriver: StorageDriver;
    storageConfig: Record<string, string> | null;
    r2BytesUsed: number;
    r2BytesLimit: number;
}

function toInvoiceSettings(d: any): InvoiceSettings {
    return {
        companyName: d.company_name ?? '',
        companyAddress: d.company_address ?? '',
        companyCity: d.company_city ?? '',
        companyState: d.company_state ?? '',
        companyZip: d.company_zip ?? '',
        companyCountry: d.company_country ?? '',
        companyLogoUrl: d.company_logo_url ?? null,
        companyTaxId: d.company_tax_id ?? null,
        invoicePrefix: d.invoice_prefix ?? '',
        invoiceSequence: Number(d.invoice_sequence ?? 0),
        autoCleanupEnabled: Boolean(d.auto_cleanup_enabled),
        autoCleanupAfterYears: Number(d.auto_cleanup_after_years ?? 0),
        requireBillingAddress: Boolean(d.require_billing_address),
        storageDriver: d.storage_driver ?? 'local',
        storageConfig: d.storage_config ?? null,
        r2BytesUsed: Number(d.r2_bytes_used ?? 0),
        r2BytesLimit: Number(d.r2_bytes_limit ?? 0),
    };
}

export async function getInvoiceSettings(): Promise<InvoiceSettings> {
    const { data } = await http.get('/api/application/billing/invoice-settings');
    return toInvoiceSettings(data);
}

// The backend accepts the snake_case payload directly; send only changed keys.
export async function updateInvoiceSettings(payload: Record<string, unknown>): Promise<InvoiceSettings> {
    const { data } = await http.put('/api/application/billing/invoice-settings', payload);
    return toInvoiceSettings(data);
}

export interface StorageUsage {
    driver: string;
    r2BytesUsed: number;
    r2BytesLimit: number;
    r2PercentUsed: number;
    localBytesUsed: number | null;
}

export async function getStorageUsage(): Promise<StorageUsage> {
    const { data } = await http.get('/api/application/billing/invoice-settings/storage-usage');
    return {
        driver: data.driver,
        r2BytesUsed: Number(data.r2_bytes_used ?? 0),
        r2BytesLimit: Number(data.r2_bytes_limit ?? 0),
        r2PercentUsed: Number(data.r2_percent_used ?? 0),
        localBytesUsed: data.local_bytes_used != null ? Number(data.local_bytes_used) : null,
    };
}

export interface ConnectionTestResult {
    ok: boolean;
    message: string;
}

export async function testStorageConnection(): Promise<ConnectionTestResult> {
    const { data } = await http.post('/api/application/billing/invoice-settings/test-connection');
    return { ok: Boolean(data.ok), message: data.message ?? '' };
}
