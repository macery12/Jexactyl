import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Activity, ChevronLeft, ChevronRight, Code2, Search, XCircle } from 'lucide-react';
import {
    getAdminActivity,
    getAdminActivityActors,
    getAdminActivityEvents,
    type AdminActivityEntry,
} from '@/api/adminActivity';
import { timeAgo } from '@/lib/format';
import { useFlags } from '@/state/flags';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ActivityDetailsModal, hasActivityDetails } from '@/pages/account/activity/ActivityDetailsModal';

type Sort = '-timestamp' | 'timestamp';

// 'admin:api-keys:create' → 'Api Keys Create'
function prettyEvent(event: string): string {
    const tail = event.split(':').slice(1).join(':') || event;
    return tail.replace(/[:._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const severityDot: Record<string, string> = {
    critical: 'bg-[var(--color-danger)]',
    warning: 'bg-[var(--color-warning)]',
    info: 'bg-[var(--brand)]',
};

function Avatar({ actor }: { actor: AdminActivityEntry['actor'] }) {
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

function ActivityRow({ entry, onInspect }: { entry: AdminActivityEntry; onInspect: (e: AdminActivityEntry) => void }) {
    const inspectable = hasActivityDetails(entry);
    const Wrapper = inspectable ? 'button' : 'div';

    return (
        <Wrapper
            {...(inspectable
                ? { type: 'button' as const, onClick: () => onInspect(entry), title: m['activity.details.inspect']() }
                : {})}
            className={cn(
                'group flex w-full items-center gap-3 px-4 py-3 text-left',
                inspectable && 'cursor-pointer transition-colors hover:bg-[var(--color-surface-2)]/50',
            )}
        >
            <span
                className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    severityDot[entry.severity ?? 'info'] ?? severityDot.info,
                )}
            />
            <Avatar actor={entry.actor} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate text-sm text-[var(--color-ink)]">
                        {entry.description || prettyEvent(entry.event)}
                    </p>
                    {entry.category && (
                        <span className="hidden shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink-muted)] sm:inline">
                            {entry.category}
                        </span>
                    )}
                    {entry.isApi && (
                        <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                            {m['activity.api']()}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">
                    <span className="text-[var(--color-ink-muted)]">{entry.actor?.username ?? m['admin.activity.system']()}</span>
                    {' · '}
                    {timeAgo(entry.timestamp)}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                </p>
            </div>
            {inspectable && (
                <Code2 className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
            )}
        </Wrapper>
    );
}

// Small labelled control used in the filter rail.
function RailField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
            {children}
        </label>
    );
}

export default function AdminActivityPage() {
    // V1 gated this route on the activity module flag; V2 handles the disabled
    // state in-page, same as ServerActivityPage (the flag lives in site config,
    // which registry `condition`s can't see).
    const enabled = useFlags(s => s.site?.activity.enabled.admin ?? true);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [actor, setActor] = useState('');
    const [event, setEvent] = useState('');
    const [sort, setSort] = useState<Sort>('-timestamp');
    const [page, setPage] = useState(1);
    const [inspecting, setInspecting] = useState<AdminActivityEntry | null>(null);

    // Debounce the search box, resetting to the first page on a new term.
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const { data: actors } = useQuery({ queryKey: ['admin', 'activity', 'actors'], queryFn: getAdminActivityActors, enabled });
    const { data: events } = useQuery({ queryKey: ['admin', 'activity', 'events'], queryFn: getAdminActivityEvents, enabled });

    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: ['admin', 'activity', { search, actor, event, sort, page }],
        queryFn: () =>
            getAdminActivity({
                page,
                sort,
                search: search || undefined,
                actor: actor || undefined,
                event: event || undefined,
            }),
        placeholderData: keepPreviousData,
        enabled,
    });

    const actorOptions = useMemo(
        () => [
            { value: '', label: m['admin.activity.allActors']() },
            ...(actors ?? []).map(a => ({ value: a.uuid, label: a.username })),
        ],
        [actors],
    );
    const eventOptions = useMemo(
        () => [
            { value: '', label: m['admin.activity.allEvents']() },
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
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.activity.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.activity.subtitle']()}</p>
                </div>
                <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-14 text-center">
                    <Activity className="h-8 w-8 text-[var(--color-ink-faint)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.activity.loggingDisabled']()}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.activity.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.activity.subtitle']()}</p>
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                {/* Filter rail */}
                <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
                    <RailField label={m['admin.activity.filter.search']()}>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                            <Input
                                value={searchInput}
                                placeholder={m['admin.activity.searchPlaceholder']()}
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
                            options={actorOptions}
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

                {/* Activity feed */}
                <div className="min-w-0 flex-1">
                    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                        {isLoading ? (
                            <div className="flex justify-center py-14">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : isError ? (
                            <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                                {m['admin.activity.loadError']()}
                            </p>
                        ) : items.length === 0 ? (
                            <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                                <Activity className="h-8 w-8 text-[var(--color-ink-faint)]" />
                                <p className="text-sm text-[var(--color-ink-muted)]">
                                    {hasActiveFilters ? m['admin.activity.emptyFiltered']() : m['admin.activity.empty']()}
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
