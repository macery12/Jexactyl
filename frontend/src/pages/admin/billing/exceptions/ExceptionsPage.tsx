import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    getBillingExceptions,
    resolveBillingException,
    resolveAllBillingExceptions,
    type BillingException,
    type BillingExceptionType,
} from '@/api/adminBillingExceptions';

const TYPE_TONE: Record<string, string> = {
    deployment: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/30',
    payment: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/30',
    storefront: 'bg-[var(--brand)]/12 text-[var(--brand)] border-[var(--brand)]/30',
    webhook: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/30',
    refund: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/30',
    validation: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/30',
};

const TYPE_LABEL: Record<string, () => string> = {
    deployment: () => m['admin.billing.exceptions.type.deployment'](),
    payment: () => m['admin.billing.exceptions.type.payment'](),
    storefront: () => m['admin.billing.exceptions.type.storefront'](),
    webhook: () => m['admin.billing.exceptions.type.webhook'](),
    refund: () => m['admin.billing.exceptions.type.refund'](),
    validation: () => m['admin.billing.exceptions.type.validation'](),
};

function TypeBadge({ type }: { type: BillingExceptionType }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                TYPE_TONE[type] ?? 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] border-[var(--color-border-strong)]',
            )}
        >
            {(TYPE_LABEL[type] ?? (() => type))()}
        </span>
    );
}

export default function ExceptionsPage() {
    const qc = useQueryClient();
    const { push } = useFlashes();

    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [resolveAllOpen, setResolveAllOpen] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
    useEffect(() => setPage(1), [search]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['admin', 'billing', 'exceptions', { page, search }],
        queryFn: () => getBillingExceptions(page, search || null),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;
    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'billing', 'exceptions'] });

    const resolve = useMutation({
        mutationFn: (e: BillingException) => resolveBillingException(e.uuid),
        onSuccess: () => {
            invalidate();
            push({ type: 'success', message: m['admin.billing.exceptions.resolved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });
    const resolveAll = useMutation({
        mutationFn: () => resolveAllBillingExceptions(),
        onSuccess: () => {
            invalidate();
            setResolveAllOpen(false);
            push({ type: 'success', message: m['admin.billing.exceptions.resolvedAll']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const total = pagination?.total ?? items.length;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.exceptions.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.exceptions.subtitle']()}</p>
                </div>
                {items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setResolveAllOpen(true)}>
                        <CheckCircle2 className="h-4 w-4" /> {m['admin.billing.exceptions.resolveAll']()}
                    </Button>
                )}
            </div>

            <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder={m['admin.billing.exceptions.searchPlaceholder']()} className="pl-9" />
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px]">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                {[
                                    m['admin.billing.exceptions.col.id'](),
                                    m['admin.billing.exceptions.col.exception'](),
                                    m['admin.billing.exceptions.col.detail'](),
                                    m['admin.billing.exceptions.col.type'](),
                                    m['admin.billing.exceptions.col.created'](),
                                    '',
                                ].map((h, i) => (
                                    <th key={i} className="px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {items.map(e => (
                                <tr key={e.id} className="align-top hover:bg-[var(--color-surface-2)]/40">
                                    <td className="px-4 py-3">
                                        <code className="rounded bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-ink-muted)]">#{e.id}</code>
                                    </td>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--color-ink)]">{e.title}</td>
                                    <td className="max-w-md px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        <span className="line-clamp-2">{e.description}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <TypeBadge type={e.exceptionType} />
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--color-ink-faint)]">{timeAgo(e.createdAt)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={resolve.isPending}
                                            onClick={() => resolve.mutate(e)}
                                        >
                                            <CheckCircle2 className="h-4 w-4" /> {m['admin.billing.exceptions.resolve']()}
                                        </Button>
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
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.billing.exceptions.empty']()}</p>
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
                open={resolveAllOpen}
                onClose={() => setResolveAllOpen(false)}
                title={m['admin.billing.exceptions.resolveAllTitle']()}
                body={m['admin.billing.exceptions.resolveAllBody']({ count: total })}
                confirmLabel={m['admin.billing.exceptions.resolveAll']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={resolveAll.isPending}
                onConfirm={() => resolveAll.mutate()}
            />
        </div>
    );
}
