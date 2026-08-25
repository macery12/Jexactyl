import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { getInvoices, getInvoiceDownloadUrl, type Invoice } from '@/api/orders';
import { timeAgo } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { orderTypeLabel, money } from './parts';

const INVOICE_TONE: Record<Invoice['status'], string> = {
    active: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] border-[var(--color-accent)]/30',
    expired: 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] border-[var(--color-border-strong)]',
    void: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/30',
};

const INVOICE_LABEL: Record<Invoice['status'], () => string> = {
    active: () => m['billing.invoices.status.active'](),
    expired: () => m['billing.invoices.status.expired'](),
    void: () => m['billing.invoices.status.void'](),
};

function InvoiceStatusPill({ status }: { status: Invoice['status'] }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                INVOICE_TONE[status],
            )}
        >
            {INVOICE_LABEL[status]()}
        </span>
    );
}

function DownloadButton({ invoice }: { invoice: Invoice }) {
    const push = useFlashes(s => s.push);
    const download = useMutation({
        mutationFn: () => getInvoiceDownloadUrl(invoice.uuid),
        onSuccess: url => window.open(url, '_blank', 'noopener'),
        onError: () => push({ type: 'error', message: m['billing.invoices.downloadError']() }),
    });

    if (!invoice.isDownloadable) {
        return <span className="text-xs italic text-[var(--color-ink-faint)]">{m['billing.invoices.expired']()}</span>;
    }

    return (
        <Button variant="outline" size="sm" disabled={download.isPending} onClick={() => download.mutate()}>
            {download.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {m['billing.invoices.download']()}
        </Button>
    );
}

export default function InvoicesTab() {
    const [page, setPage] = useState(1);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['account', 'invoices', { page }],
        queryFn: () => getInvoices(page),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    return (
        <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px]">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                {[
                                    m['billing.invoices.col.number'](),
                                    m['billing.invoices.col.type'](),
                                    m['billing.invoices.col.amount'](),
                                    m['billing.invoices.col.status'](),
                                    m['billing.invoices.col.generated'](),
                                    '',
                                ].map((h, i) => (
                                    <th
                                        key={i}
                                        className="px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {items.map(inv => (
                                <tr key={inv.uuid} className="transition-colors hover:bg-[var(--color-surface-2)]">
                                    <td className="px-4 py-3 font-mono text-sm text-[var(--color-ink)]">
                                        {inv.invoiceNumber}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        {inv.orderType ? orderTypeLabel(inv.orderType) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink)]">
                                        {money(inv.total / 100, inv.currency)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <InvoiceStatusPill status={inv.status} />
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-faint)]">
                                        {inv.generatedAt ? timeAgo(inv.generatedAt) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <DownloadButton invoice={inv} />
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
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-ink-muted)]">
                        {m['billing.invoices.empty']()}
                    </p>
                ) : null}
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.currentPage, total: pagination.totalPages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage <= 1 || isFetching}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage >= pagination.totalPages || isFetching}
                            onClick={() => setPage(p => p + 1)}
                        >
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
