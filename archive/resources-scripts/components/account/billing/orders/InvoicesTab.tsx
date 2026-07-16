import { useContext, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import Pill from '@/elements/Pill';
import AdminTable, {
    Loading,
    NoItems,
    Pagination,
    TableBody,
    TableHead,
    TableHeader,
    useTableHooks,
} from '@/elements/AdminTable';
import {
    ClientInvoice,
    Context as InvoiceContext,
    ClientInvoiceFilters,
    useGetClientInvoices,
    getClientInvoiceDownloadUrl,
} from '@/api/routes/account/billing/invoices';
import useFlash from '@/plugins/useFlash';

function statusPill(status: ClientInvoice['status']) {
    switch (status) {
        case 'active':
            return <Pill status="success">Active</Pill>;
        case 'expired':
            return <Pill status="unknown">Expired</Pill>;
        case 'void':
            return <Pill status="danger">Void</Pill>;
    }
}

function orderTypePill(type: string | null) {
    if (!type) return <span className="text-neutral-500">—</span>;
    const labels: Record<string, string> = { new: 'New', ren: 'Renewal', upg: 'Upgrade', dng: 'Downgrade' };
    return <span className="text-sm text-neutral-300">{labels[type] ?? type}</span>;
}

function InvoiceRow({ invoice }: { invoice: ClientInvoice }) {
    const { addFlash, clearFlashes } = useFlash();
    const [loading, setLoading] = useState(false);

    const handleDownload = () => {
        clearFlashes('billing:invoices');
        setLoading(true);
        getClientInvoiceDownloadUrl(invoice.uuid)
            .then(url => window.open(url, '_blank'))
            .catch(() => addFlash({ key: 'billing:invoices', type: 'error', message: 'Failed to get download link.' }))
            .finally(() => setLoading(false));
    };

    return (
        <tr className="border-b border-neutral-700/50 hover:bg-neutral-700/20">
            <td className="px-4 py-3 font-mono text-sm text-neutral-200">{invoice.invoice_number}</td>
            <td className="px-4 py-3">{orderTypePill(invoice.order_type)}</td>
            <td className="px-4 py-3 text-sm text-neutral-200">
                {invoice.currency} {(invoice.total / 100).toFixed(2)}
            </td>
            <td className="px-4 py-3">{statusPill(invoice.status)}</td>
            <td className="px-4 py-3 text-sm text-neutral-400">
                {invoice.generated_at
                    ? formatDistanceToNowStrict(new Date(invoice.generated_at), { addSuffix: true })
                    : '—'}
            </td>
            <td className="px-4 py-3">
                {invoice.is_downloadable ? (
                    <button
                        disabled={loading}
                        onClick={handleDownload}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? 'Loading…' : 'Download PDF'}
                    </button>
                ) : (
                    <span className="text-xs text-neutral-500 italic">Invoice expired</span>
                )}
            </td>
        </tr>
    );
}

function InvoicesTable() {
    const { data: invoices, error } = useGetClientInvoices();
    const { setPage, setFilters } = useContext(InvoiceContext);

    return (
        <AdminTable>
            <TableHead>
                <TableHeader name="Invoice #" />
                <TableHeader name="Type" />
                <TableHeader name="Amount" />
                <TableHeader name="Status" />
                <TableHeader name="Generated" />
                <TableHeader name="" />
            </TableHead>
            <TableBody>
                {(!invoices || (invoices.items.length === 0 && error)) && <Loading />}
                {invoices?.items.length === 0 && !error && <NoItems />}
                {invoices?.items.map(inv => (
                    <InvoiceRow key={inv.uuid} invoice={inv} />
                ))}
            </TableBody>
            {invoices && <Pagination data={invoices} onPageSelect={setPage} />}
        </AdminTable>
    );
}

export default () => {
    const hooks = useTableHooks<ClientInvoiceFilters>();

    return (
        <InvoiceContext.Provider value={hooks}>
            <InvoicesTable />
        </InvoiceContext.Provider>
    );
};
