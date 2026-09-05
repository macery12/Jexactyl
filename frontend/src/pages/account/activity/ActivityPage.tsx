import { m } from '@/i18n/messages';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Code2, Search } from 'lucide-react';
import { getActivityPage, getOwnedServers, type ActivityEntry } from '@/api/activity';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ActivityDetailsModal, hasActivityDetails } from './ActivityDetailsModal';

type Scope = 'all' | 'account' | 'server';

// 'auth:session_revoked' → 'Session Revoked'
function prettyEvent(event: string): string {
    const tail = event.split(':').pop() ?? event;
    return tail.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const severityDot: Record<string, string> = {
    critical: 'bg-[var(--color-danger)]',
    warning: 'bg-[var(--color-warning)]',
    info: 'bg-[var(--brand)]',
};

function ActivityRow({ entry, onInspect }: { entry: ActivityEntry; onInspect: (entry: ActivityEntry) => void }) {
    const inspectable = hasActivityDetails(entry);
    const body = (
        <>
            <span
                className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', severityDot[entry.severity ?? 'info'] ?? severityDot.info)}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate text-sm text-[var(--color-ink)]">
                        {entry.description || prettyEvent(entry.event)}
                    </p>
                    {entry.category && (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink-muted)]">
                            {entry.category}
                        </span>
                    )}
                    {entry.isApi && (
                        <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                            {m['activity.api']()}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                    {timeAgo(entry.timestamp)}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                </p>
            </div>
            {inspectable && (
                <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
            )}
        </>
    );

    if (!inspectable) {
        return <div className="flex items-start gap-3 px-4 py-3">{body}</div>;
    }

    return (
        <button
            type="button"
            onClick={() => onInspect(entry)}
            title={m['activity.details.inspect']()}
            className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)]"
        >
            {body}
        </button>
    );
}

export default function ActivityPage() {
    const [scope, setScope] = useState<Scope>('all');
    const [server, setServer] = useState<string>('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [inspecting, setInspecting] = useState<ActivityEntry | null>(null);

    const { data: servers } = useQuery({ queryKey: ['account', 'owned-servers'], queryFn: getOwnedServers });

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['account', 'activity', { scope, server, query, page }],
        queryFn: () =>
            getActivityPage({
                page,
                scope: scope === 'all' ? undefined : scope,
                server: scope !== 'account' && server ? server : undefined,
                event: query || undefined,
            }),
        placeholderData: keepPreviousData,
    });

    const scopeOptions = [
        { value: 'all', label: m['activity.scope.all']() },
        { value: 'account', label: m['activity.scope.account']() },
        { value: 'server', label: m['activity.scope.server']() },
    ];

    const serverOptions = [
        { value: '', label: m['activity.allServers']() },
        ...(servers ?? []).map(s => ({ value: s.uuid, label: s.name })),
    ];

    const reset = () => setPage(1);
    const submitSearch = () => {
        setQuery(search.trim());
        reset();
    };

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['activity.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['activity.subtitle']()}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="w-full sm:w-44">
                    <Select
                        value={scope}
                        onChange={v => {
                            setScope(v as Scope);
                            if (v === 'account') setServer('');
                            reset();
                        }}
                        options={scopeOptions}
                    />
                </div>
                {scope !== 'account' && (servers?.length ?? 0) > 0 && (
                    <div className="w-full sm:w-56">
                        <Select
                            value={server}
                            onChange={v => {
                                setServer(v);
                                reset();
                            }}
                            options={serverOptions}
                        />
                    </div>
                )}
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={search}
                        placeholder={m['activity.searchPlaceholder']()}
                        className="pl-9"
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitSearch()}
                    />
                </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70">
                {isLoading ? (
                    <div className="flex justify-center py-10">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : items.length > 0 ? (
                    <div className="divide-y divide-[var(--color-border)]">
                        {items.map(entry => (
                            <ActivityRow key={entry.id} entry={entry} onInspect={setInspecting} />
                        ))}
                    </div>
                ) : (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
                        {m['activity.empty']()}
                    </p>
                )}
            </div>

            {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.current_page, total: pagination.total_pages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.current_page <= 1 || isFetching}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.current_page >= pagination.total_pages || isFetching}
                            onClick={() => setPage(p => p + 1)}
                        >
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <ActivityDetailsModal entry={inspecting} onClose={() => setInspecting(null)} />
        </div>
    );
}
