import { m } from '@/i18n/messages';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LifeBuoy } from 'lucide-react';
import { getAdminTickets } from '@/api/adminTickets';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFullWidthContent } from '@/components/shell/shellLayout';
import {
    StatusBadge,
    PriorityBadge,
    TICKET_STATUSES,
    TICKET_PRIORITIES,
    priorityLabel,
    type TicketStatus,
    type TicketPriority,
} from '@/components/tickets/meta';

type StatusFilter = 'all' | TicketStatus;

const SORTS = [
    { value: '-last_reply_at', key: 'admin.tickets.sort.recentReply' },
    { value: '-created_at', key: 'admin.tickets.sort.newest' },
    { value: 'created_at', key: 'admin.tickets.sort.oldest' },
    { value: '-priority', key: 'admin.tickets.sort.priority' },
] as const;

function statusTab(status: TicketStatus): string {
    switch (status) {
        case 'pending':
            return m['tickets.status.pending']();
        case 'in-progress':
            return m['tickets.status.inProgress']();
        case 'resolved':
            return m['tickets.status.resolved']();
        case 'unresolved':
            return m['tickets.status.unresolved']();
    }
}

function sortLabel(key: string): string {
    switch (key) {
        case 'admin.tickets.sort.recentReply':
            return m['admin.tickets.sort.recentReply']();
        case 'admin.tickets.sort.newest':
            return m['admin.tickets.sort.newest']();
        case 'admin.tickets.sort.oldest':
            return m['admin.tickets.sort.oldest']();
        default:
            return m['admin.tickets.sort.priority']();
    }
}

export default function TicketsListPage() {
    useFullWidthContent();
    const navigate = useNavigate();
    const [status, setStatus] = useState<StatusFilter>('all');
    const [priority, setPriority] = useState<'all' | TicketPriority>('all');
    const [sort, setSort] = useState<string>('-last_reply_at');
    const [page, setPage] = useState(1);

    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: ['admin', 'tickets', { status, priority, sort, page }],
        queryFn: () =>
            getAdminTickets({
                page,
                status: status === 'all' ? undefined : status,
                priority: priority === 'all' ? undefined : priority,
                sort,
            }),
        placeholderData: keepPreviousData,
    });

    const reset = () => setPage(1);
    const items = data?.items ?? [];
    const pagination = data?.pagination;

    const tabs: StatusFilter[] = ['all', ...TICKET_STATUSES];

    const priorityOptions = [
        { value: 'all', label: m['admin.tickets.filter.allPriorities']() },
        ...TICKET_PRIORITIES.map(p => ({ value: p, label: priorityLabel(p) })),
    ];
    const sortOptions = SORTS.map(s => ({ value: s.value, label: sortLabel(s.key) }));

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.tickets.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.tickets.subtitle']()}</p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {tabs.map(f => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => {
                            setStatus(f);
                            reset();
                        }}
                        className={cn(
                            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                            status === f
                                ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-inset ring-[var(--brand)]/30'
                                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        {f === 'all' ? m['tickets.filter.all']() : statusTab(f)}
                    </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                    <div className="w-40">
                        <Select
                            value={priority}
                            onChange={v => {
                                setPriority(v as 'all' | TicketPriority);
                                reset();
                            }}
                            options={priorityOptions}
                        />
                    </div>
                    <div className="w-44">
                        <Select
                            value={sort}
                            onChange={v => {
                                setSort(v);
                                reset();
                            }}
                            options={sortOptions}
                        />
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['tickets.loadError']()}</p>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <LifeBuoy className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.tickets.empty']()}</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                                <th className="px-4 py-2.5 font-medium">{m['admin.tickets.col.subject']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium md:table-cell">{m['admin.tickets.col.requester']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">{m['admin.tickets.col.assignee']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{m['admin.tickets.col.priority']()}</th>
                                <th className="px-4 py-2.5 font-medium">{m['admin.tickets.col.status']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{m['admin.tickets.col.lastReply']()}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(t => (
                                <tr
                                    key={t.id}
                                    onClick={() => navigate(`/admin/tickets/${t.id}`)}
                                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/50"
                                >
                                    <td className="px-4 py-3">
                                        <span className="block truncate font-medium text-[var(--color-ink)]">{t.title}</span>
                                        <span className="text-xs text-[var(--color-ink-faint)]">
                                            {m['tickets.ref']({ id: t.id })}
                                            {t.server ? ` · ${t.server.name}` : ''}
                                        </span>
                                    </td>
                                    <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] md:table-cell">
                                        {t.user?.username ?? '—'}
                                    </td>
                                    <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] lg:table-cell">
                                        {t.assignedTo?.username ?? (
                                            <span className="text-[var(--color-ink-faint)]">{m['admin.tickets.unassigned']()}</span>
                                        )}
                                    </td>
                                    <td className="hidden px-4 py-3 sm:table-cell">
                                        <PriorityBadge priority={t.priority} />
                                    </td>
                                    <td className="px-4 py-3">
                                        <StatusBadge status={t.status} />
                                    </td>
                                    <td className="hidden px-4 py-3 text-xs text-[var(--color-ink-faint)] sm:table-cell">
                                        {timeAgo(t.lastReplyAt ?? t.createdAt)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
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
