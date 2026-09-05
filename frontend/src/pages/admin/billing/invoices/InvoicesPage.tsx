import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, RotateCcw, RefreshCw, Ban, Search } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { timeAgo, formatBytes } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    getAdminInvoices,
    getAdminInvoiceDownloadUrl,
    voidInvoice,
    regenerateInvoice,
    resendInvoiceEmail,
    type AdminInvoice,
    type AdminInvoiceStatus,
} from '@/api/adminBillingInvoices';

const STATUS_TONE: Record<AdminInvoiceStatus, string> = {
    active: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] border-[var(--color-accent)]/30',
    expired: 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] border-[var(--color-border-strong)]',
    void: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/30',
};

const STATUS_LABEL: Record<AdminInvoiceStatus, () => string> = {
    active: () => m['billing.invoices.status.active'](),
    expired: () => m['billing.invoices.status.expired'](),
    void: () => m['billing.invoices.status.void'](),
};

function StatusPill({ status }: { status: AdminInvoiceStatus }) {
    return (
        <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_TONE[status])}>
            {STATUS_LABEL[status]()}
        </span>
    );
}

function PdfBadge({ invoice }: { invoice: AdminInvoice }) {
    if (invoice.hasCachedPdf) {
        return (
            <span className="inline-flex items-center rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/12 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                {m['admin.billing.invoices.pdf.cached']()}
            </span>
        );
    }
    if (invoice.status === 'active' && invoice.isDownloadable) {
        return (
            <span className="inline-flex items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">
                {m['admin.billing.invoices.pdf.onDemand']()}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-faint)]">
            {m['admin.billing.invoices.pdf.none']()}
        </span>
    );
}

export default function InvoicesPage() {
    const qc = useQueryClient();
    const { push } = useFlashes();

    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [voidTarget, setVoidTarget] = useState<AdminInvoice | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters = useMemo(() => ({ search: search || undefined, status: status || undefined }), [search, status]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
    useEffect(() => setPage(1), [filters]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['admin', 'billing', 'invoices', { page, filters }],
        queryFn: () => getAdminInvoices(page, filters),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;
    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'billing', 'invoices'] });

    const download = async (inv: AdminInvoice) => {
        try {
            const url = await getAdminInvoiceDownloadUrl(inv.uuid);
            window.open(url, '_blank');
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['billing.invoices.downloadError']() });
        }
    };

    const resend = useMutation({
        mutationFn: (inv: AdminInvoice) => resendInvoiceEmail(inv.uuid),
        onSuccess: (_d, inv) => push({ type: 'success', message: m['admin.billing.invoices.resent']({ email: inv.user?.email ?? '' }) }),
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });
    const regenerate = useMutation({
        mutationFn: (inv: AdminInvoice) => regenerateInvoice(inv.uuid),
        onSuccess: () => {
            invalidate();
            push({ type: 'success', message: m['admin.billing.invoices.regenerated']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });
    const doVoid = useMutation({
        mutationFn: (inv: AdminInvoice) => voidInvoice(inv.uuid),
        onSuccess: () => {
            invalidate();
            setVoidTarget(null);
            push({ type: 'success', message: m['admin.billing.invoices.voided']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const busy = resend.isPending || regenerate.isPending || doVoid.isPending;

    const statusOptions = [
        { value: '', label: m['admin.billing.invoices.filter.allStatuses']() },
        { value: 'active', label: m['billing.invoices.status.active']() },
        { value: 'expired', label: m['billing.invoices.status.expired']() },
        { value: 'void', label: m['billing.invoices.status.void']() },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.invoices.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.invoices.subtitle']()}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-3">
                <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={searchInput}
                        placeholder={m['admin.billing.invoices.searchPlaceholder']()}
                        className="pl-9"
                        onChange={e => setSearchInput(e.target.value)}
                    />
                </div>
                <div className="w-44">
                    <Select value={status} onChange={setStatus} options={statusOptions} />
                </div>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px]">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                {[
                                    m['billing.invoices.col.number'](),
                                    m['admin.billing.invoices.col.user'](),
                                    m['billing.invoices.col.amount'](),
                                    m['billing.invoices.col.status'](),
                                    m['admin.billing.invoices.col.generated'](),
                                    m['admin.billing.invoices.col.size'](),
                                    m['admin.billing.invoices.col.pdf'](),
                                    m['admin.billing.invoices.col.actions'](),
                                ].map(h => (
                                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {items.map(inv => (
                                <tr key={inv.uuid} className="hover:bg-[var(--color-surface-2)]/40">
                                    <td className="px-4 py-3 font-mono text-sm text-[var(--color-ink)]">{inv.invoiceNumber}</td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">{inv.user?.email ?? '—'}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--color-ink)]">
                                        {inv.currency} {inv.total.toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <StatusPill status={inv.status} />
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--color-ink-faint)]">
                                        {inv.generatedAt ? timeAgo(inv.generatedAt) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-faint)]">
                                        {inv.dataSizeBytes ? formatBytes(inv.dataSizeBytes) : '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <PdfBadge invoice={inv} />
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1">
                                            {inv.isDownloadable && (
                                                <Button variant="ghost" size="icon" aria-label={m['billing.invoices.download']()} onClick={() => download(inv)}>
                                                    <Download className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={m['admin.billing.invoices.resend']()}
                                                disabled={busy}
                                                onClick={() => resend.mutate(inv)}
                                            >
                                                <RotateCcw className="h-4 w-4" />
                                            </Button>
                                            {inv.status !== 'void' && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={m['admin.billing.invoices.regenerate']()}
                                                        disabled={busy}
                                                        onClick={() => regenerate.mutate(inv)}
                                                    >
                                                        <RefreshCw className="h-4 w-4 text-[var(--color-warning)]" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={m['admin.billing.invoices.void']()}
                                                        disabled={busy}
                                                        onClick={() => setVoidTarget(inv)}
                                                    >
                                                        <Ban className="h-4 w-4 text-[var(--color-danger)]" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : items.length === 0 ? (
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.billing.invoices.empty']()}</p>
                ) : null}
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.currentPage, total: pagination.totalPages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={pagination.currentPage <= 1 || isFetching} onClick={() => setPage(p => Math.max(1, p - 1))}>
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button variant="outline" size="sm" disabled={pagination.currentPage >= pagination.totalPages || isFetching} onClick={() => setPage(p => p + 1)}>
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(voidTarget)}
                onClose={() => setVoidTarget(null)}
                title={m['admin.billing.invoices.voidTitle']()}
                body={m['admin.billing.invoices.voidBody']({ number: voidTarget?.invoiceNumber ?? '' })}
                confirmLabel={m['admin.billing.invoices.void']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={doVoid.isPending}
                onConfirm={() => voidTarget && doVoid.mutate(voidTarget)}
            />
        </div>
    );
}
