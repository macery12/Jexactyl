import http from '@/api/http';
import { createPaginatedHook, createContext } from '@/api';

export interface AdminInvoice {
    uuid: string;
    invoice_number: string;
    status: 'active' | 'expired' | 'void';
    data_disk: string | null;
    data_size_bytes: number | null;
    has_cached_pdf: boolean;
    pdf_expires_at: string | null;
    total: number;
    currency: string;
    generated_at: string | null;
    expires_at: string | null;
    voided_at: string | null;
    voided_reason: string | null;
    order_id: number;
    user: { id: number; username: string; email: string } | null;
    is_downloadable: boolean;
}

export interface InvoiceFilters {
    status?: string;
    user_id?: number;
    search?: string;
    date_from?: string;
    date_to?: string;
}

export const Context = createContext<InvoiceFilters>();

export const useGetAdminInvoices = createPaginatedHook<AdminInvoice, InvoiceFilters>({
    url: '/api/application/billing/invoices',
    swrKey: 'admin-invoices',
    context: Context,
    transformer: ({ attributes }: any): AdminInvoice => attributes,
});

export const getAdminInvoiceDownloadUrl = (uuid: string): Promise<string> =>
    http.get(`/api/application/billing/invoices/${uuid}/download`).then(({ data }) => data.url);

export const voidInvoice = (uuid: string, reason?: string): Promise<AdminInvoice> =>
    http.post(`/api/application/billing/invoices/${uuid}/void`, { reason }).then(({ data }) => data);

export const regenerateInvoice = (uuid: string): Promise<AdminInvoice> =>
    http.post(`/api/application/billing/invoices/${uuid}/regenerate`).then(({ data }) => data);

export const resendInvoiceEmail = (uuid: string): Promise<void> =>
    http.post(`/api/application/billing/invoices/${uuid}/resend`).then(() => undefined);

export interface InvoiceSettings {
    company_name: string;
    company_address: string;
    company_city: string;
    company_state: string;
    company_zip: string;
    company_country: string;
    company_logo_url: string | null;
    company_tax_id: string | null;
    invoice_prefix: string;
    invoice_sequence: number;
    auto_cleanup_enabled: boolean;
    auto_cleanup_after_years: number;
    require_billing_address: boolean;
    storage_driver: 'local' | 's3' | 'r2';
    storage_config: Record<string, string> | null;
    r2_bytes_used: number;
    r2_bytes_limit: number;
}

export interface StorageUsage {
    driver: string;
    r2_bytes_used: number;
    r2_bytes_limit: number;
    r2_percent_used: number;
    local_bytes_used?: number | null;
}

export const getInvoiceSettings = (): Promise<InvoiceSettings> =>
    http.get('/api/application/billing/invoice-settings').then(({ data }) => data);

export const updateInvoiceSettings = (payload: Partial<InvoiceSettings>): Promise<InvoiceSettings> =>
    http.put('/api/application/billing/invoice-settings', payload).then(({ data }) => data);

export const getStorageUsage = (): Promise<StorageUsage> =>
    http.get('/api/application/billing/invoice-settings/storage-usage').then(({ data }) => data);

export interface ConnectionTestResult {
    ok: boolean;
    message: string;
}

export const testStorageConnection = (): Promise<ConnectionTestResult> =>
    http.post('/api/application/billing/invoice-settings/test-connection').then(({ data }) => data);
