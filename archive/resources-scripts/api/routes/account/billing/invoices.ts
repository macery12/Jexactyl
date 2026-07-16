import http from '@/api/http';
import { createPaginatedHook, createContext } from '@/api';

export interface ClientInvoice {
    uuid: string;
    invoice_number: string;
    status: 'active' | 'expired' | 'void';
    total: number;
    currency: string;
    generated_at: string | null;
    has_cached_pdf: boolean;
    order_id: number;
    order_type: string | null;
    is_downloadable: boolean;
}

export interface ClientInvoiceFilters {
    status?: string;
}

export const Context = createContext<ClientInvoiceFilters>();

export const useGetClientInvoices = createPaginatedHook<ClientInvoice, ClientInvoiceFilters>({
    url: '/api/client/billing/invoices',
    swrKey: 'client-invoices',
    context: Context,
    transformer: ({ attributes }: any): ClientInvoice => attributes,
});

export const getClientInvoiceDownloadUrl = (uuid: string): Promise<string> =>
    http.get(`/api/client/billing/invoices/${uuid}/download`).then(({ data }) => data.url);
