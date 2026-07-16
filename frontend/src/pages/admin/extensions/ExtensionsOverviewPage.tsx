import { m } from '@/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Puzzle, RefreshCw, Package, Power, ArrowUpCircle, GitBranch, Search } from 'lucide-react';
import {
    type Extension,
    getExtensions,
    getRepositories,
    getNestsAndEggs,
    getProgress,
    refreshCatalog,
    toggleExtension,
    installExtension,
} from '@/api/extensions';
import { Spinner } from '@/components/ui/Spinner';
import { Input } from '@/components/ui/Input';
import { useFlashes } from '@/state/flashes';
import { cn } from '@/lib/cn';
import { ExtensionCard } from './ExtensionCard';
import { ExtensionManageDrawer } from './ExtensionManageDrawer';
import { RepositoriesPanel } from './RepositoriesPanel';
import { OperationProgressBanner } from './OperationProgress';

type Filter = 'all' | 'installed' | 'available' | 'updates';

function SummaryCell({ icon: Icon, label, value, sub }: { icon: typeof Puzzle; label: string; value: string; sub?: string }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{label}</p>
                <p className="font-mono text-lg leading-none tabular-nums text-[var(--color-ink)]">{value}</p>
                {sub && <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">{sub}</p>}
            </div>
        </div>
    );
}

export default function ExtensionsOverviewPage() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [filter, setFilter] = useState<Filter>('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Extension | null>(null);

    const extensionsQuery = useQuery({ queryKey: ['admin', 'extensions'], queryFn: getExtensions });
    const reposQuery = useQuery({ queryKey: ['admin', 'extension-repositories'], queryFn: getRepositories });
    const nestsQuery = useQuery({ queryKey: ['admin', 'extension-nests-eggs'], queryFn: getNestsAndEggs, staleTime: 60_000 });

    // Poll the server-side operation stage. Fast cadence while something runs,
    // relaxed when idle. Buttons lock for the duration of an active op.
    const progressQuery = useQuery({
        queryKey: ['admin', 'extension-progress'],
        queryFn: getProgress,
        refetchInterval: q => {
            const p = q.state.data;
            return p && p.stage !== 'completed' ? 1200 : 6000;
        },
    });
    const progress = progressQuery.data ?? null;
    const active = !!progress && progress.stage !== 'completed';

    // When an operation finishes, refresh the catalog so new state lands.
    const prevActive = useRef(false);
    useEffect(() => {
        if (prevActive.current && !active) {
            qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
            qc.invalidateQueries({ queryKey: ['admin', 'extension-repositories'] });
        }
        prevActive.current = active;
    }, [active, qc]);

    const extensions = extensionsQuery.data ?? [];

    // Keep the open drawer's data fresh after mutations invalidate the list.
    useEffect(() => {
        if (!selected) return;
        const next = extensions.find(e => e.id === selected.id);
        if (next && next !== selected) setSelected(next);
    }, [extensions, selected]);

    const reportError = (err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        push({ type: 'error', message: status === 409 ? m['extensions.toast.running']() : m['common.states.genericError']() });
    };

    const toggle = useMutation({
        mutationFn: (ext: Extension) => toggleExtension(ext.id),
        onSuccess: (e, ext) => {
            push({ type: 'success', message: (ext.enabled ? m['extensions.toast.disabled'] : m['extensions.toast.enabled'])({ name: e.name }) });
            qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
        },
        onError: reportError,
    });

    const install = useMutation({
        mutationFn: (ext: Extension) => installExtension(ext.id, ext.source.repositoryId!, ext.latestVersion),
        onSuccess: e => {
            push({ type: 'success', message: m['extensions.toast.installed']({ name: e.name }) });
            qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
        },
        onError: reportError,
    });

    const refresh = useMutation({
        mutationFn: refreshCatalog,
        onSuccess: data => {
            qc.setQueryData(['admin', 'extensions'], data);
            qc.invalidateQueries({ queryKey: ['admin', 'extension-repositories'] });
            push({ type: 'success', message: m['extensions.toast.refreshed']() });
        },
        onError: reportError,
    });

    const counts = useMemo(() => {
        const installed = extensions.filter(e => e.installed).length;
        const enabled = extensions.filter(e => e.enabled).length;
        const updates = extensions.filter(e => e.updateAvailable).length;
        return { installed, enabled, updates };
    }, [extensions]);

    const repos = reposQuery.data ?? [];
    const repoIssues = repos.filter(r => r.status === 'error').length;

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return extensions.filter(e => {
            if (filter === 'installed' && !e.installed) return false;
            if (filter === 'available' && !e.installable) return false;
            if (filter === 'updates' && !e.updateAvailable) return false;
            if (q) {
                const hay = `${e.name} ${e.description} ${e.id} ${e.author}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [extensions, filter, search]);

    const segments: Array<{ id: Filter; label: string }> = [
        { id: 'all', label: m['extensions.filters.all']() },
        { id: 'installed', label: m['extensions.filters.installed']() },
        { id: 'available', label: m['extensions.filters.available']() },
        { id: 'updates', label: m['extensions.filters.updates']() },
    ];

    const togglingId = toggle.isPending ? toggle.variables?.id : undefined;
    const installingId = install.isPending ? install.variables?.id : undefined;

    return (
        <div className="relative flex flex-col gap-4">
            <div className="bg-grid pointer-events-none absolute inset-x-0 -top-6 h-72 -z-10 opacity-60" />

            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['extensions.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['extensions.subtitle']()}</p>
                </div>
                <button
                    type="button"
                    disabled={refresh.isPending}
                    onClick={() => refresh.mutate()}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-[var(--color-border-strong)] px-4 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                    <RefreshCw className={cn('h-4 w-4', refresh.isPending && 'animate-spin')} />
                    {refresh.isPending ? m['extensions.refreshing']() : m['extensions.refresh']()}
                </button>
            </div>

            {progress && active && <OperationProgressBanner progress={progress} />}

            {extensionsQuery.isLoading && (
                <div className="flex items-center justify-center py-24">
                    <Spinner className="h-7 w-7" />
                </div>
            )}

            {extensionsQuery.isError && (
                <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                    {m['extensions.loadError']()}
                </div>
            )}

            {!extensionsQuery.isLoading && !extensionsQuery.isError && (
                <>
                    <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 sm:divide-y-0 lg:grid-cols-4">
                        <SummaryCell
                            icon={Package}
                            label={m['extensions.summary.installed']()}
                            value={String(counts.installed)}
                            sub={m['extensions.summary.ofInstalled']({ count: extensions.length })}
                        />
                        <SummaryCell
                            icon={Power}
                            label={m['extensions.summary.enabled']()}
                            value={String(counts.enabled)}
                            sub={m['extensions.summary.available']({ count: extensions.filter(e => e.installable).length })}
                        />
                        <SummaryCell
                            icon={ArrowUpCircle}
                            label={m['extensions.summary.updates']()}
                            value={String(counts.updates)}
                            sub={counts.updates > 0 ? m['extensions.summary.needsAttention']({ count: counts.updates }) : m['extensions.summary.upToDate']()}
                        />
                        <SummaryCell
                            icon={GitBranch}
                            label={m['extensions.summary.repositories']()}
                            value={String(repos.length)}
                            sub={repoIssues > 0 ? m['extensions.summary.withIssues']({ count: repoIssues }) : m['extensions.summary.connected']({ count: repos.filter(r => r.enabled).length })}
                        />
                    </div>

                    {/* toolbar: segmented filter + search */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-1">
                            {segments.map(seg => (
                                <button
                                    key={seg.id}
                                    type="button"
                                    onClick={() => setFilter(seg.id)}
                                    className={cn(
                                        'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                        filter === seg.id
                                            ? 'bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                            : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                                    )}
                                >
                                    {seg.label}
                                </button>
                            ))}
                        </div>
                        <div className="relative sm:w-64">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder={m['extensions.filters.searchPlaceholder']()}
                                className="h-10 pl-9"
                            />
                        </div>
                    </div>

                    {visible.length === 0 ? (
                        <EmptyState search={search} hasAny={extensions.length > 0} />
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {visible.map(ext => (
                                <ExtensionCard
                                    key={ext.id}
                                    ext={ext}
                                    locked={active}
                                    toggling={togglingId === ext.id}
                                    installing={installingId === ext.id}
                                    onOpen={() => setSelected(ext)}
                                    onToggle={() => toggle.mutate(ext)}
                                    onInstall={() => install.mutate(ext)}
                                />
                            ))}
                        </div>
                    )}

                    <RepositoriesPanel repositories={repos} />
                </>
            )}

            <ExtensionManageDrawer
                ext={selected}
                nests={nestsQuery.data?.nests ?? []}
                eggs={nestsQuery.data?.eggs ?? []}
                locked={active}
                onClose={() => setSelected(null)}
            />
        </div>
    );
}

function EmptyState({ search, hasAny }: { search: string; hasAny: boolean }) {
    const q = search.trim();
    const title = q ? m['extensions.empty.searchTitle']() : hasAny ? m['extensions.empty.filterTitle']() : m['extensions.empty.title']();
    const body = q ? m['extensions.empty.searchBody']({ query: q }) : hasAny ? m['extensions.empty.filterBody']() : m['extensions.empty.body']();
    return (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-2)]">
                <Puzzle className="h-6 w-6 text-[var(--color-ink-muted)]" />
            </div>
            <h3 className="text-lg font-medium">{title}</h3>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">{body}</p>
        </div>
    );
}
