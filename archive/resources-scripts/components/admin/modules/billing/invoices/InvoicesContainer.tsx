import { useContext, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import useFlash from '@/plugins/useFlash';
import Pill from '@/elements/Pill';
import AdminTable, {
    Pagination,
    TableHead,
    TableHeader,
    TableBody,
    Loading,
    NoItems,
    useTableHooks,
} from '@/elements/AdminTable';
import {
    AdminInvoice,
    Context as InvoiceContext,
    InvoiceFilters,
    useGetAdminInvoices,
    getAdminInvoiceDownloadUrl,
    voidInvoice,
    regenerateInvoice,
    resendInvoiceEmail,
} from '@/api/routes/admin/billing/invoices';
import Input from '@/elements/Input';

function formatBytes(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusPill(status: AdminInvoice['status']) {
    switch (status) {
        case 'active':
            return <Pill status="success">Active</Pill>;
        case 'expired':
            return <Pill status="unknown">Expired</Pill>;
        case 'void':
            return <Pill status="danger">Void</Pill>;
    }
}

function InvoiceRow({ invoice, onRefresh }: { invoice: AdminInvoice; onRefresh: () => void }) {
    const { addFlash, clearFlashes } = useFlash();
    const [loading, setLoading] = useState(false);

    const handleDownload = () => {
        clearFlashes('admin:invoices');
        getAdminInvoiceDownloadUrl(invoice.uuid)
            .then(url => window.open(url, '_blank'))
            .catch(() => addFlash({ key: 'admin:invoices', type: 'error', message: 'Failed to get download URL.' }));
    };

    const handleVoid = () => {
        if (!confirm(`Void invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
        setLoading(true);
        clearFlashes('admin:invoices');
        voidInvoice(invoice.uuid)
            .then(() => {
                onRefresh();
            })
            .catch(err =>
                addFlash({ key: 'admin:invoices', type: 'error', message: err.message ?? 'Failed to void invoice.' }),
            )
            .finally(() => setLoading(false));
    };

    const handleRegenerate = () => {
        if (!confirm(`Regenerate PDF for ${invoice.invoice_number}?`)) return;
        setLoading(true);
        clearFlashes('admin:invoices');
        regenerateInvoice(invoice.uuid)
            .then(() => {
                onRefresh();
            })
            .catch(err =>
                addFlash({
                    key: 'admin:invoices',
                    type: 'error',
                    message: err.message ?? 'Failed to regenerate invoice.',
                }),
            )
            .finally(() => setLoading(false));
    };

    const handleResend = () => {
        setLoading(true);
        clearFlashes('admin:invoices');
        resendInvoiceEmail(invoice.uuid)
            .then(() =>
                addFlash({
                    key: 'admin:invoices',
                    type: 'success',
                    message: `Invoice email queued for ${invoice.user?.email}.`,
                }),
            )
            .catch(err =>
                addFlash({ key: 'admin:invoices', type: 'error', message: err.message ?? 'Failed to resend invoice.' }),
            )
            .finally(() => setLoading(false));
    };

    return (
        <tr className="border-b border-neutral-700 hover:bg-neutral-700/30">
            <td className="px-4 py-3 font-mono text-sm text-neutral-200">{invoice.invoice_number}</td>
            <td className="px-4 py-3 text-sm text-neutral-300">{invoice.user?.email ?? '—'}</td>
            <td className="px-4 py-3 text-sm text-neutral-300">
                {invoice.currency} {(invoice.total / 100).toFixed(2)}
            </td>
            <td className="px-4 py-3">{statusPill(invoice.status)}</td>
            <td className="px-4 py-3 text-sm text-neutral-400">
                {invoice.generated_at
                    ? formatDistanceToNowStrict(new Date(invoice.generated_at), { addSuffix: true })
                    : '—'}
            </td>
            <td className="px-4 py-3 text-sm text-neutral-400">{formatBytes(invoice.data_size_bytes)}</td>
            <td className="px-4 py-3">
                {invoice.has_cached_pdf ? (
                    <Pill
                        status="success"
                        title={
                            invoice.pdf_expires_at
                                ? `Expires ${formatDistanceToNowStrict(new Date(invoice.pdf_expires_at), { addSuffix: true })}`
                                : undefined
                        }
                    >
                        Cached
                    </Pill>
                ) : invoice.status === 'active' && invoice.is_downloadable ? (
                    <Pill status="unknown">On Demand</Pill>
                ) : (
                    <Pill status="inactive">No Data</Pill>
                )}
            </td>
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    {invoice.is_downloadable && (
                        <button
                            disabled={loading}
                            onClick={handleDownload}
                            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            Download
                        </button>
                    )}
                    <button
                        disabled={loading}
                        onClick={handleResend}
                        className="rounded bg-neutral-600 px-2 py-1 text-xs text-white hover:bg-neutral-500 disabled:opacity-50"
                    >
                        Rebuild
                    </button>
                    {invoice.status !== 'void' && (
                        <>
                            <button
                                disabled={loading}
                                onClick={handleRegenerate}
                                className="rounded bg-yellow-700 px-2 py-1 text-xs text-white hover:bg-yellow-600 disabled:opacity-50"
                            >
                                Regen
                            </button>
                            <button
                                disabled={loading}
                                onClick={handleVoid}
                                className="rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-50"
                            >
                                Void
                            </button>
                        </>
                    )}
                </div>
            </td>
        </tr>
    );
}

function InvoicesTable() {
    const { data: invoices, error, mutate } = useGetAdminInvoices();
    const { setSort, sort, setPage, sortDirection, setFilters } = useContext(InvoiceContext);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');

    const applyFilters = () => {
        const f: InvoiceFilters = {};
        if (search) f.search = search;
        if (status) f.status = status;
        setFilters(f);
    };

    const clearFilters = () => {
        setSearch('');
        setStatus('');
        setFilters({});
    };

    return (
        <>
            {/* Filter bar */}
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400">Search</label>
                    <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Invoice #, email, username..."
                        className="w-64 text-sm"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400">Status</label>
                    <select
                        value={status}
                        onChange={e => setStatus(e.target.value)}
                        className="rounded border border-neutral-600 bg-neutral-700 px-2 py-1.5 text-sm text-neutral-100"
                    >
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                        <option value="void">Void</option>
                    </select>
                </div>
                <button
                    onClick={applyFilters}
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                    Filter
                </button>
                <button
                    onClick={clearFilters}
                    className="rounded bg-neutral-600 px-3 py-1.5 text-sm text-white hover:bg-neutral-500"
                >
                    Clear
                </button>
            </div>

            <AdminTable>
                <TableHead>
                    <TableHeader
                        name="Invoice #"
                        onClick={() => setSort('invoice_number')}
                        direction={sort === 'invoice_number' ? sortDirection : undefined}
                    />
                    <TableHeader name="User" />
                    <TableHeader
                        name="Amount"
                        onClick={() => setSort('total')}
                        direction={sort === 'total' ? sortDirection : undefined}
                    />
                    <TableHeader
                        name="Status"
                        onClick={() => setSort('status')}
                        direction={sort === 'status' ? sortDirection : undefined}
                    />
                    <TableHeader
                        name="Generated"
                        onClick={() => setSort('generated_at')}
                        direction={sort === 'generated_at' ? sortDirection : undefined}
                    />
                    <TableHeader name="Size" />
                    <TableHeader name="PDF" />
                    <TableHeader name="Actions" />
                </TableHead>
                <TableBody>
                    {(!invoices || (invoices.items.length === 0 && error)) && <Loading />}
                    {invoices?.items.length === 0 && !error && <NoItems />}
                    {invoices?.items.map(inv => (
                        <InvoiceRow key={inv.uuid} invoice={inv} onRefresh={() => mutate()} />
                    ))}
                </TableBody>
            </AdminTable>
            {invoices && <Pagination data={invoices} onPageSelect={setPage} />}
        </>
    );
}

export default () => {
    const hooks = useTableHooks<InvoiceFilters>();

    return (
        <div>
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h2 className="font-header text-xl font-medium text-neutral-50">Invoices</h2>
                    <p className="text-sm text-neutral-400">Manage PDF invoices generated for processed orders.</p>
                </div>
            </div>
            <InvoiceContext.Provider value={hooks}>
                <InvoicesTable />
            </InvoiceContext.Provider>
        </div>
    );
};
