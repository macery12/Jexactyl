import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Activity, ChevronLeft, ChevronRight, Code2, Search, Terminal, FolderOpen, XCircle } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useFlags } from '@/state/flags';
import { useServer } from '@/components/server/ServerContext';
import {
    getServerActivityPage,
    getServerActivityUsers,
    getServerActivityEvents,
    type ServerActivityEntry,
} from '@/api/serverActivity';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ActivityDetailsModal, hasActivityDetails } from '@/pages/account/activity/ActivityDetailsModal';
import FileDiffViewer, { type FileDiff } from './FileDiffViewer';

type Sort = '-timestamp' | 'timestamp';

// 'server:file.write' → 'File Write'
function prettyEvent(event: string): string {
    const tail = event.split(':').slice(1).join(':') || event;
    return tail.replace(/[:._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const severityDot: Record<string, string> = {
    critical: 'bg-[var(--color-danger)]',
    warning: 'bg-[var(--color-warning)]',
    info: 'bg-[var(--brand)]',
};

// Only file-write events carry a parsed diff payload.
function getFileDiff(entry: ServerActivityEntry): FileDiff | null {
    if (entry.event !== 'server:file.write' && entry.event !== 'server:sftp.write') return null;
    const diff = entry.properties?.diff;
    if (!diff || typeof diff !== 'object') return null;

    const d = diff as Record<string, unknown>;
    const files = entry.properties?.files;
    const file =
        (entry.properties?.file as string | undefined) ??
        (Array.isArray(files) ? (files[0] as string | undefined) : undefined);

    return {
        file,
        additions: (d.additions as number) ?? 0,
        deletions: (d.deletions as number) ?? 0,
        hunks: (d.hunks as FileDiff['hunks']) ?? [],
        is_new_file: (d.is_new_file as boolean) ?? false,
        large_file: (d.large_file as boolean) ?? false,
    };
}

// Console/SSH commands are worth showing verbatim rather than as a description.
function getCommand(entry: ServerActivityEntry): string | null {
    if (entry.event !== 'server:console.command' && entry.event !== 'server:ssh.command') return null;
    const command = entry.properties?.command;
    return typeof command === 'string' ? command : null;
}

function Avatar({ actor }: { actor: ServerActivityEntry['actor'] }) {
    if (actor?.avatarUrl) {
        return <img src={actor.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full" />;
    }
    const initial = (actor?.username ?? '?').charAt(0).toUpperCase();
    return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-ink-muted)]">
            {initial}
        </span>
    );
}

function ActivityRow({
    entry,
    onInspect,
}: {
    entry: ServerActivityEntry;
    onInspect: (entry: ServerActivityEntry) => void;
}) {
    const inspectable = hasActivityDetails(entry);
    const diff = getFileDiff(entry);
    const command = getCommand(entry);
    const viaSftp = entry.event.startsWith('server:sftp.') || entry.source === 'sftp';
    const viaSsh = entry.event.startsWith('server:ssh.') || entry.source === 'ssh';

    return (
        <div className="group flex items-start gap-3 px-4 py-3">
            <span
                className={cn(
                    'mt-2.5 h-2 w-2 shrink-0 rounded-full',
                    severityDot[entry.severity ?? 'info'] ?? severityDot.info,
                )}
            />
            <Avatar actor={entry.actor} />

            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm text-[var(--color-ink)]">
                                {entry.description || prettyEvent(entry.event)}
                            </p>
                            {viaSftp && (
                                <FolderOpen
                                    className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]"
                                    aria-label={m['server.activity.viaSftp']()}
                                />
                            )}
                            {viaSsh && (
                                <Terminal
                                    className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]"
                                    aria-label={m['server.activity.viaSsh']()}
                                />
                            )}
                            {entry.context === 'admin' && (
                                <span className="shrink-0 rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-danger)]">
                                    {m['server.activity.admin']()}
                                </span>
                            )}
                            {entry.isApi && (
                                <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                                    {m['activity.api']()}
                                </span>
                            )}
                            {entry.category && (
                                <span className="hidden shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink-muted)] sm:inline">
                                    {entry.category}
                                </span>
                            )}
                        </div>

                        <p className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">
                            <span className="text-[var(--color-ink-muted)]" title={entry.actor?.email ?? undefined}>
                                {entry.actor?.username ?? m['server.activity.system']()}
                            </span>
                            {' · '}
                            <span title={new Date(entry.timestamp).toLocaleString()}>{timeAgo(entry.timestamp)}</span>
                            {entry.ip ? ` · ${entry.ip}` : ''}
                        </p>
                    </div>

                    {inspectable && (
                        <button
                            type="button"
                            onClick={() => onInspect(entry)}
                            title={m['activity.details.inspect']()}
                            className="mt-0.5 shrink-0 rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:opacity-100 group-hover:opacity-100"
                        >
                            <Code2 className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {command && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-[11px] text-[var(--color-ink-muted)]">
                        {command}
                    </pre>
                )}
                {diff && (
                    <div className="mt-2">
                        <FileDiffViewer diff={diff} />
                    </div>
                )}
            </div>
        </div>
    );
}

function RailField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
            {children}
        </label>
    );
}

// Reads the `#event=…&ip=…` deep-link filters V1 wrote into the location hash,
// so links out of the console/overview panels keep working.
function useHashFilters(): { event?: string; ip?: string } {
    const { hash } = useLocation();
    return useMemo(() => {
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        return { event: params.get('event') ?? undefined, ip: params.get('ip') ?? undefined };
    }, [hash]);
}

export default function ServerActivityPage() {
    const server = useServer();
    const enabled = useFlags(s => s.site?.activity.enabled.server ?? true);
    const hashFilters = useHashFilters();

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [actor, setActor] = useState('');
    const [event, setEvent] = useState('');
    const [sort, setSort] = useState<Sort>('-timestamp');
    const [page, setPage] = useState(1);
    const [inspecting, setInspecting] = useState<ServerActivityEntry | null>(null);

    // Debounce the search box, resetting to the first page on a new term.
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    // A deep link drives the event dropdown so the rail reflects what's applied.
    useEffect(() => {
        if (hashFilters.event) {
            setEvent(hashFilters.event);
            setPage(1);
        }
    }, [hashFilters.event]);

    const { data: users } = useQuery({
        queryKey: ['server', server.id, 'activity', 'users'],
        queryFn: () => getServerActivityUsers(server.uuid),
        enabled,
    });
    const { data: events } = useQuery({
        queryKey: ['server', server.id, 'activity', 'events'],
        queryFn: () => getServerActivityEvents(server.uuid),
        enabled,
    });

    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: ['server', server.id, 'activity', { search, actor, event, sort, page, ip: hashFilters.ip }],
        queryFn: () =>
            getServerActivityPage(server.uuid, {
                page,
                sort,
                search: search || undefined,
                actor: actor || undefined,
                event: event || undefined,
                ip: hashFilters.ip,
            }),
        placeholderData: keepPreviousData,
        enabled,
    });

    const userOptions = useMemo(
        () => [
            { value: '', label: m['server.activity.allUsers']() },
            ...(users ?? []).map(u => ({ value: u.uuid, label: u.username })),
        ],
        [users],
    );
    const eventOptions = useMemo(
        () => [
            { value: '', label: m['server.activity.allEvents']() },
            ...(events ?? []).map(e => ({ value: e, label: e })),
        ],
        [events],
    );
    const sortOptions = [
        { value: '-timestamp', label: m['admin.activity.sort.newest']() },
        { value: 'timestamp', label: m['admin.activity.sort.oldest']() },
    ];

    const hasActiveFilters = searchInput.trim() !== '' || actor !== '' || event !== '' || sort !== '-timestamp';

    const resetPage = () => setPage(1);
    const clearFilters = () => {
        setSearchInput('');
        setSearch('');
        setActor('');
        setEvent('');
        setSort('-timestamp');
        setPage(1);
    };

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    if (!enabled) {
        return (
            <div className="flex flex-col gap-6">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.activity.page.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.activity.subtitle']()}</p>
                </div>
                <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-14 text-center">
                    <Activity className="h-8 w-8 text-[var(--color-ink-faint)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['server.activity.loggingDisabled']()}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.activity.page.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.activity.subtitle']()}</p>
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
                    <RailField label={m['admin.activity.filter.search']()}>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                            <Input
                                value={searchInput}
                                placeholder={m['server.activity.searchPlaceholder']()}
                                className="pl-9"
                                onChange={e => setSearchInput(e.target.value)}
                            />
                        </div>
                    </RailField>
                    <RailField label={m['admin.activity.filter.user']()}>
                        <Select
                            value={actor}
                            onChange={v => {
                                setActor(v);
                                resetPage();
                            }}
                            options={userOptions}
                        />
                    </RailField>
                    <RailField label={m['admin.activity.filter.event']()}>
                        <Select
                            value={event}
                            onChange={v => {
                                setEvent(v);
                                resetPage();
                            }}
                            options={eventOptions}
                        />
                    </RailField>
                    <RailField label={m['admin.activity.filter.sort']()}>
                        <Select
                            value={sort}
                            onChange={v => {
                                setSort(v as Sort);
                                resetPage();
                            }}
                            options={sortOptions}
                        />
                    </RailField>
                    {hasActiveFilters && (
                        <Button variant="outline" size="sm" onClick={clearFilters} className="justify-center">
                            <XCircle className="h-4 w-4" />
                            {m['admin.activity.clearFilters']()}
                        </Button>
                    )}
                </aside>

                <div className="min-w-0 flex-1">
                    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                        {isLoading ? (
                            <div className="flex justify-center py-14">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : isError ? (
                            <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                                {m['server.activity.loadError']()}
                            </p>
                        ) : items.length === 0 ? (
                            <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                                <Activity className="h-8 w-8 text-[var(--color-ink-faint)]" />
                                <p className="text-sm text-[var(--color-ink-muted)]">
                                    {hasActiveFilters
                                        ? m['admin.activity.emptyFiltered']()
                                        : m['server.activity.page.empty']()}
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--color-border)]">
                                {items.map(entry => (
                                    <ActivityRow key={entry.id} entry={entry} onInspect={setInspecting} />
                                ))}
                            </div>
                        )}
                    </div>

                    {pagination && pagination.totalPages > 1 && (
                        <div className="mt-4 flex items-center justify-between">
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

            <ActivityDetailsModal entry={inspecting} onClose={() => setInspecting(null)} />
        </div>
    );
}
