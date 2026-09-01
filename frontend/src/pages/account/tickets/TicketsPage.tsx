import { m } from '@/i18n/messages';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, LifeBuoy, ChevronRight } from 'lucide-react';
import { getTickets } from '@/api/tickets';
import { useFlags } from '@/state/flags';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { StatusBadge, PriorityBadge, TICKET_STATUSES, type TicketStatus } from '@/components/tickets/meta';
import { NewTicketModal } from './NewTicketModal';

type Filter = 'all' | TicketStatus;

export default function TicketsPage() {
    const tickets = useFlags(s => s.everest?.tickets);
    const [filter, setFilter] = useState<Filter>('all');
    const [creating, setCreating] = useState(false);

    const { data, isLoading, isError } = useQuery({ queryKey: ['account', 'tickets'], queryFn: getTickets });

    const counts = useMemo(() => {
        const map: Record<string, number> = { all: data?.length ?? 0 };
        for (const s of TICKET_STATUSES) map[s] = 0;
        for (const t of data ?? []) map[t.status] = (map[t.status] ?? 0) + 1;
        return map;
    }, [data]);

    const visible = useMemo(
        () => (filter === 'all' ? data ?? [] : (data ?? []).filter(t => t.status === filter)),
        [data, filter],
    );

    const maxCount = tickets?.maxCount ?? 0;
    const atLimit = maxCount > 0 && (data?.length ?? 0) >= maxCount;

    const tabs: Filter[] = ['all', ...TICKET_STATUSES];

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['tickets.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['tickets.subtitle']()}</p>
                </div>
                <Button size="sm" disabled={atLimit} onClick={() => setCreating(true)}>
                    <Plus className="h-4 w-4" />
                    {m['tickets.new.button']()}
                </Button>
            </div>

            {atLimit && (
                <p className="rounded-[var(--radius-card)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/[0.06] px-4 py-2.5 text-xs text-[var(--color-warning)]">
                    {m['tickets.limitReached']({ count: maxCount })}
                </p>
            )}

            <div className="flex flex-wrap gap-1.5">
                {tabs.map(f => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        className={cn(
                            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                            filter === f
                                ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-inset ring-[var(--brand)]/30'
                                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        {f === 'all' ? m['tickets.filter.all']() : statusTabLabel(f)}
                        <span className="text-[var(--color-ink-faint)]">{counts[f] ?? 0}</span>
                    </button>
                ))}
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70">
                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['tickets.loadError']()}</p>
                ) : visible.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <LifeBuoy className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['tickets.empty']()}</p>
                        {!atLimit && (
                            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                                <Plus className="h-4 w-4" />
                                {m['tickets.new.button']()}
                            </Button>
                        )}
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {visible.map(t => (
                            <li key={t.id}>
                                <Link
                                    to={`/tickets/${t.id}`}
                                    className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--color-surface-2)]/50"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium text-[var(--color-ink)]">{t.title}</span>
                                        </div>
                                        <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                                            {m['tickets.ref']({ id: t.id })} ·{' '}
                                            {m['tickets.updatedAgo']({ ago: timeAgo(t.lastReplyAt ?? t.createdAt) })}
                                            {t.server ? ` · ${t.server.name}` : ''}
                                        </p>
                                    </div>
                                    <PriorityBadge priority={t.priority} className="hidden sm:inline-flex" />
                                    <StatusBadge status={t.status} />
                                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <NewTicketModal open={creating} onClose={() => setCreating(false)} />
        </div>
    );
}

function statusTabLabel(status: TicketStatus): string {
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
