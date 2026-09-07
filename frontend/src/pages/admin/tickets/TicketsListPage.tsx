import { m } from '@/i18n/messages';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock3, LifeBuoy } from 'lucide-react';
import { getAdminTickets } from '@/api/adminTickets';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
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
        <div className="@container flex min-w-0 flex-col gap-6">
            <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--brand)]/20 bg-[var(--brand)]/10 text-[var(--brand)]">
                    <LifeBuoy className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.tickets.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.tickets.subtitle']()}</p>
                </div>
            </div>

            <div className="min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="flex flex-col gap-4 border-b border-[var(--color-border)] p-4 @4xl:flex-row @4xl:items-center @4xl:justify-between">
                    <div className="flex flex-wrap items-center gap-1">
                        {tabs.map(f => (
                            <button
                                key={f}
                                type="button"
                                aria-pressed={status === f}
                                onClick={() => {
                                    setStatus(f);
                                    reset();
                                }}
                                className={cn(
                                    'min-h-9 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                                    status === f
                                        ? 'bg-[var(--brand)]/12 text-[var(--color-ink)] ring-1 ring-inset ring-[var(--brand)]/25'
                                        : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                                )}
                            >
                                {f === 'all' ? m['tickets.filter.all']() : statusTab(f)}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 @4xl:w-80 @4xl:shrink-0">
                        <div className="min-w-0">
                            <label htmlFor="ticket-priority" className="sr-only">{m['admin.tickets.col.priority']()}</label>
                            <Select
                                id="ticket-priority"
                                value={priority}
                                onChange={v => {
                                    setPriority(v as 'all' | TicketPriority);
                                    reset();
                                }}
                                options={priorityOptions}
                                className="h-9 px-3 text-xs [&>span:first-child]:truncate"
                            />
                        </div>
                        <div className="min-w-0">
                            <label htmlFor="ticket-sort" className="sr-only">{m['server.files.sortBy']()}</label>
                            <Select
                                id="ticket-sort"
                                value={sort}
                                onChange={v => {
                                    setSort(v);
                                    reset();
                                }}
                                options={sortOptions}
                                className="h-9 px-3 text-xs [&>span:first-child]:truncate"
                            />
                        </div>
                    </div>
                </div>

                <div aria-busy={isFetching}>
                    {isLoading ? (
                        <div className="flex justify-center py-16" role="status" aria-label={m['common.states.loading']()}>
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : isError ? (
                        <p role="alert" className="px-4 py-12 text-center text-sm text-[var(--color-danger)]">{m['tickets.loadError']()}</p>
                    ) : items.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
                            <div className="rounded-2xl bg-[var(--color-surface-2)] p-4">
                                <LifeBuoy className="h-7 w-7 text-[var(--color-ink-faint)]" aria-hidden="true" />
                            </div>
                            <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.tickets.empty']()}</p>
                        </div>
                    ) : (
                        <>
                            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_8rem_6rem] gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--color-ink-faint)] @3xl:grid">
                                <span>{m['admin.tickets.col.subject']()}</span>
                                <span>{m['admin.tickets.col.requester']()}</span>
                                <span>{m['admin.tickets.col.assignee']()}</span>
                                <span>{m['admin.tickets.col.status']()} / {m['admin.tickets.col.priority']()}</span>
                                <span className="text-right">{m['admin.tickets.col.lastReply']()}</span>
                            </div>
                            <ul className="divide-y divide-[var(--color-border)]">
                                {items.map(t => (
                                    <li key={t.id}>
                                        <Link
                                            to={`/admin/tickets/${t.id}`}
                                            className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-[var(--color-surface-2)]/60 focus-visible:bg-[var(--color-surface-2)] focus-visible:outline-offset-[-2px] @3xl:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_8rem_6rem] @3xl:px-5"
                                        >
                                            <div className="col-span-2 min-w-0 @3xl:col-span-1">
                                                <span className="block break-words text-sm font-medium text-[var(--color-ink)] group-hover:text-[var(--brand)] @3xl:truncate" title={t.title}>{t.title}</span>
                                                <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[var(--color-ink-faint)]">
                                                    <span className="shrink-0 font-mono">{m['tickets.ref']({ id: t.id })}</span>
                                                    {t.server && <span className="truncate" title={t.server.name}>· {t.server.name}</span>}
                                                </span>
                                            </div>
                                            <div className="min-w-0 text-xs text-[var(--color-ink-muted)] @3xl:text-sm">
                                                <span className="sr-only">{m['admin.tickets.col.requester']()}: </span>
                                                <span className="block truncate" title={t.user?.username}>{t.user?.username ?? '—'}</span>
                                                <span className="mt-1 block truncate text-[var(--color-ink-faint)] @3xl:hidden">
                                                    {m['admin.tickets.col.assignee']()}: {t.assignedTo?.username ?? m['admin.tickets.unassigned']()}
                                                </span>
                                            </div>
                                            <div className="hidden min-w-0 truncate text-sm text-[var(--color-ink-muted)] @3xl:block" title={t.assignedTo?.username}>
                                                <span className="sr-only">{m['admin.tickets.col.assignee']()}: </span>
                                                {t.assignedTo?.username ?? (
                                                    <span className="text-xs text-[var(--color-ink-faint)]">{m['admin.tickets.unassigned']()}</span>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end gap-1.5 @3xl:items-start">
                                                <StatusBadge status={t.status} className="whitespace-nowrap" />
                                                <PriorityBadge priority={t.priority} className="whitespace-nowrap" />
                                            </div>
                                            <span className="col-span-2 flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] @3xl:col-span-1 @3xl:justify-end @3xl:text-right">
                                                <Clock3 className="h-3 w-3 shrink-0 @3xl:hidden" aria-hidden="true" />
                                                <span className="sr-only">{m['admin.tickets.col.lastReply']()}: </span>
                                                {timeAgo(t.lastReplyAt ?? t.createdAt)}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>

                {pagination && pagination.totalPages > 1 && !isError && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/30 px-4 py-3">
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
        </div>
    );
}
