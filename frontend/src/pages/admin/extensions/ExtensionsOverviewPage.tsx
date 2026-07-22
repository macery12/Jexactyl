import { m } from '@/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Puzzle, RefreshCw, Package, Power, ArrowUpCircle, GitBranch, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
    type Extension,
    type DatabasePlanOperation,
    type BatchDropDataItem,
    getExtensions,
    getRepositories,
    getNestsAndEggs,
    getProgress,
    refreshCatalog,
    toggleExtension,
    installExtension,
    batchInstallExtensions,
    batchUninstallExtensions,
    batchUpdateExtensions,
} from '@/api/extensions';
import { BatchActionBar } from './BatchActionBar';
import { DatabaseChangesModal, type DbModalExtension } from './DatabaseChangesModal';
import { Spinner } from '@/components/ui/Spinner';
import { Input } from '@/components/ui/Input';
import { useFlashes } from '@/state/flashes';
import { cn } from '@/lib/cn';
import { ExtensionsTable, type Sort, type SortKey } from './ExtensionsTable';
import { extensionTone } from './extMeta';
import { ExtensionManageDrawer } from './ExtensionManageDrawer';
import { RepositoriesPanel } from './RepositoriesPanel';
import { OperationProgressBanner } from './OperationProgress';

const PAGE_SIZES = [25, 50, 100];

// Sort rank for the status column: things needing attention float up.
const STATUS_RANK: Record<string, number> = { update: 0, enabled: 1, installed: 2, available: 3, core: 4 };

// Numeric-aware version compare (semver-ish; missing parts sort as 0).
function compareVersion(a: string, b: string): number {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

// Map a batch operation to the extensions the database-changes modal previews.
// Install/update carry the repository + version so the backend can fetch and
// parse the archive; uninstall reads local state and needs neither.
function batchModalExtensions(
    op: DatabasePlanOperation,
    lists: { forInstall: Extension[]; forUninstall: Extension[]; forUpdate: Extension[] },
): DbModalExtension[] {
    if (op === 'uninstall') return lists.forUninstall.map(e => ({ id: e.id, name: e.name }));
    const src = op === 'install' ? lists.forInstall : lists.forUpdate;
    return src.map(e => ({ id: e.id, name: e.name, repositoryId: e.source.repositoryId, version: e.latestVersion }));
}

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
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Which batch database-changes review modal is open (null = none).
    const [batchModal, setBatchModal] = useState<DatabasePlanOperation | null>(null);
    // The row whose one-click Install is awaiting database-changes review.
    const [rowInstall, setRowInstall] = useState<Extension | null>(null);
    const [sort, setSort] = useState<Sort>({ key: 'status', dir: 'asc' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    // Anchor index for shift-click range selection (indexes into the current page).
    const lastSelectedIndex = useRef<number | null>(null);

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

    const extensions = useMemo(() => extensionsQuery.data ?? [], [extensionsQuery.data]);

    // Keep the open drawer's data fresh after mutations invalidate the list.
    useEffect(() => {
        if (!selected) return;
        const next = extensions.find(e => e.id === selected.id);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
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

    // ---- multi-select + batch actions -------------------------------------
    const clearSelection = () => setSelectedIds(new Set());
    const toggleSelect = (id: string) =>
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const selectedExts = useMemo(() => extensions.filter(e => selectedIds.has(e.id)), [extensions, selectedIds]);

    // Eligibility per batch action (mirrors the per-card affordances).
    const isManageable = (e: Extension) => e.installed && !e.installable;
    const forInstall = selectedExts.filter(e => e.installable && e.source.repositoryId != null && e.compatible !== false);
    const forUninstall = selectedExts.filter(e => e.canUninstall);
    const forUpdate = selectedExts.filter(e => e.updateAvailable && e.source.repositoryId != null);
    const forEnable = selectedExts.filter(e => isManageable(e) && !e.enabled);
    const forDisable = selectedExts.filter(e => isManageable(e) && e.enabled);

    const onBatchSuccess = (data: Extension[], messageFn: () => string) => {
        qc.setQueryData(['admin', 'extensions'], data);
        qc.invalidateQueries({ queryKey: ['admin', 'extension-repositories'] });
        clearSelection();
        push({ type: 'success', message: messageFn() });
    };

    const batchInstall = useMutation({
        mutationFn: () =>
            batchInstallExtensions(
                forInstall.map(e => ({ extensionId: e.id, repositoryId: e.source.repositoryId!, version: e.latestVersion })),
            ),
        onSuccess: data => onBatchSuccess(data, () => m['extensions.toast.batchInstalled']({ count: forInstall.length })),
        onError: reportError,
    });

    const batchUninstall = useMutation({
        mutationFn: (drops: BatchDropDataItem[]) => batchUninstallExtensions(forUninstall.map(e => e.id), drops),
        onSuccess: data => onBatchSuccess(data, () => m['extensions.toast.batchUninstalled']({ count: forUninstall.length })),
        onError: reportError,
    });

    const batchUpdate = useMutation({
        mutationFn: () =>
            batchUpdateExtensions(
                forUpdate.map(e => ({ extensionId: e.id, repositoryId: e.source.repositoryId!, version: e.latestVersion })),
            ),
        onSuccess: data => onBatchSuccess(data, () => m['extensions.toast.batchUpdated']({ count: forUpdate.length })),
        onError: reportError,
    });

    // Enable/disable have no batch endpoint; fan out single toggles and report
    // an aggregate result (partial failures surface a warning).
    const runToggleBatch = async (targets: Extension[]) => {
        const results = await Promise.allSettled(targets.map(e => toggleExtension(e.id)));
        return results.filter(r => r.status === 'rejected').length;
    };

    const batchEnable = useMutation({
        mutationFn: () => runToggleBatch(forEnable),
        onSuccess: failed => {
            clearSelection();
            qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
            push(
                failed > 0
                    ? { type: 'warning', message: m['extensions.toast.batchPartial']({ succeeded: forEnable.length - failed, failed }) }
                    : { type: 'success', message: m['extensions.toast.batchEnabled']({ count: forEnable.length }) },
            );
        },
        onError: reportError,
    });

    const batchDisable = useMutation({
        mutationFn: () => runToggleBatch(forDisable),
        onSuccess: failed => {
            clearSelection();
            qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
            push(
                failed > 0
                    ? { type: 'warning', message: m['extensions.toast.batchPartial']({ succeeded: forDisable.length - failed, failed }) }
                    : { type: 'success', message: m['extensions.toast.batchDisabled']({ count: forDisable.length }) },
            );
        },
        onError: reportError,
    });

    const batchBusy =
        batchInstall.isPending ||
        batchUninstall.isPending ||
        batchUpdate.isPending ||
        batchEnable.isPending ||
        batchDisable.isPending;

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

    // Drop selections for extensions that fell out of the catalog (e.g. after an
    // uninstall) so the batch bar never acts on stale ids.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setSelectedIds(prev => {
            const live = new Set(extensions.map(e => e.id));
            const next = new Set([...prev].filter(id => live.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [extensions]);

    // Sort the filtered set, then page it client-side (the full catalog arrives in
    // one request, so search/sort/paging are all instant and need no round-trips).
    const sorted = useMemo(() => {
        const ver = (e: Extension) => (e.installed ? e.version : e.latestVersion);
        const dir = sort.dir === 'asc' ? 1 : -1;
        return [...visible].sort((a, b) => {
            let r = 0;
            switch (sort.key) {
                case 'name':
                    r = a.name.localeCompare(b.name);
                    break;
                case 'type':
                    r = a.type.localeCompare(b.type);
                    break;
                case 'status':
                    r = (STATUS_RANK[extensionTone(a)] ?? 9) - (STATUS_RANK[extensionTone(b)] ?? 9);
                    break;
                case 'version':
                    r = compareVersion(ver(a), ver(b));
                    break;
            }
            return (r || a.name.localeCompare(b.name)) * dir;
        });
    }, [visible, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

    // Reset to the first page whenever the result set or ordering changes, and
    // clamp the page if the set shrank underneath the current position.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
    useEffect(() => setPage(1), [filter, search, sort, pageSize]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        if (page > pageCount) setPage(pageCount);
    }, [page, pageCount]);

    const onSort = (key: SortKey) =>
        setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

    // Header checkbox selects/deselects the current page's rows.
    const allPageSelected = pageRows.length > 0 && pageRows.every(e => selectedIds.has(e.id));
    const somePageSelected = !allPageSelected && pageRows.some(e => selectedIds.has(e.id));
    const togglePage = () =>
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (allPageSelected) pageRows.forEach(e => next.delete(e.id));
            else pageRows.forEach(e => next.add(e.id));
            return next;
        });

    // Per-row selection with shift-click range support (adds the span between the
    // last-clicked row and this one, always additive — matching file-list UIs).
    const handleRowSelect = (index: number, shiftKey: boolean) => {
        const row = pageRows[index];
        if (!row) return;
        if (shiftKey && lastSelectedIndex.current !== null) {
            const lo = Math.min(lastSelectedIndex.current, index);
            const hi = Math.max(lastSelectedIndex.current, index);
            setSelectedIds(prev => {
                const next = new Set(prev);
                pageRows.slice(lo, hi + 1).forEach(e => next.add(e.id));
                return next;
            });
        } else {
            toggleSelect(row.id);
        }
        lastSelectedIndex.current = index;
    };

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
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-4 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
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
                        <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-1">
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
                        <div className="flex flex-col gap-3">
                            <ExtensionsTable
                                rows={pageRows}
                                selectedIds={selectedIds}
                                sort={sort}
                                onSort={onSort}
                                allPageSelected={allPageSelected}
                                somePageSelected={somePageSelected}
                                onTogglePage={togglePage}
                                locked={active || batchBusy}
                                togglingId={togglingId}
                                installingId={installingId}
                                onOpen={ext => setSelected(ext)}
                                onToggle={ext => toggle.mutate(ext)}
                                onInstall={ext => setRowInstall(ext)}
                                onRowSelect={handleRowSelect}
                            />
                            <TablePagination
                                total={sorted.length}
                                page={page}
                                pageCount={pageCount}
                                pageSize={pageSize}
                                onPage={setPage}
                                onPageSize={setPageSize}
                            />
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

            <BatchActionBar
                count={selectedIds.size}
                busy={batchBusy || active}
                counts={{
                    install: forInstall.length,
                    uninstall: forUninstall.length,
                    update: forUpdate.length,
                    enable: forEnable.length,
                    disable: forDisable.length,
                }}
                onClear={clearSelection}
                onInstall={() => setBatchModal('install')}
                onUninstall={() => setBatchModal('uninstall')}
                onUpdate={() => setBatchModal('update')}
                onEnable={() => batchEnable.mutate()}
                onDisable={() => {
                    if (window.confirm(m['extensions.select.confirmDisable']({ count: forDisable.length }))) batchDisable.mutate();
                }}
            />

            {batchModal && (
                <DatabaseChangesModal
                    open
                    operation={batchModal}
                    busy={batchBusy}
                    extensions={batchModalExtensions(batchModal, { forInstall, forUninstall, forUpdate })}
                    onClose={() => setBatchModal(null)}
                    onConfirm={drops => {
                        if (batchModal === 'install') batchInstall.mutate();
                        else if (batchModal === 'update') batchUpdate.mutate();
                        else batchUninstall.mutate(drops);
                        setBatchModal(null);
                    }}
                />
            )}

            {/* The table's one-click Install gets the same database review the
                drawer and batch bar do — no install skips the preview. */}
            {rowInstall && (
                <DatabaseChangesModal
                    open
                    operation="install"
                    busy={install.isPending}
                    extensions={[
                        {
                            id: rowInstall.id,
                            name: rowInstall.name,
                            repositoryId: rowInstall.source.repositoryId,
                            version: rowInstall.latestVersion,
                        },
                    ]}
                    onClose={() => setRowInstall(null)}
                    onConfirm={() => {
                        install.mutate(rowInstall);
                        setRowInstall(null);
                    }}
                />
            )}
        </div>
    );
}

function TablePagination({
    total,
    page,
    pageCount,
    pageSize,
    onPage,
    onPageSize,
}: {
    total: number;
    page: number;
    pageCount: number;
    pageSize: number;
    onPage: (p: number) => void;
    onPageSize: (n: number) => void;
}) {
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return (
        <div className="flex flex-col items-center justify-between gap-3 px-1 sm:flex-row">
            <p className="text-xs tabular-nums text-[var(--color-ink-muted)]">
                {m['extensions.table.showing']({ start, end, total })}
            </p>
            <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                    {m['extensions.table.rowsPerPage']()}
                    <select
                        value={pageSize}
                        onChange={e => onPageSize(Number(e.target.value))}
                        className="h-8 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-ink)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus-ring)] focus-visible:border-[var(--color-focus)]"
                    >
                        {PAGE_SIZES.map(n => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onPage(page - 1)}
                        disabled={page <= 1}
                        aria-label={m['extensions.table.prev']()}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[6.5rem] text-center text-xs tabular-nums text-[var(--color-ink-muted)]">
                        {m['extensions.table.page']({ page, pages: pageCount })}
                    </span>
                    <button
                        type="button"
                        onClick={() => onPage(page + 1)}
                        disabled={page >= pageCount}
                        aria-label={m['extensions.table.next']()}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function EmptyState({ search, hasAny }: { search: string; hasAny: boolean }) {
    const q = search.trim();
    const title = q ? m['extensions.empty.searchTitle']() : hasAny ? m['extensions.empty.filterTitle']() : m['extensions.empty.title']();
    const body = q ? m['extensions.empty.searchBody']({ query: q }) : hasAny ? m['extensions.empty.filterBody']() : m['extensions.empty.body']();
    return (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
                <Puzzle className="h-6 w-6 text-[var(--color-ink-muted)]" />
            </div>
            <h3 className="text-lg font-medium">{title}</h3>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">{body}</p>
        </div>
    );
}
