import { m } from '@/i18n/messages';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Server, Plus, ChevronDown, Zap, HardDrive, Layers } from 'lucide-react';
import { getAdminServers, type AdminServer } from '@/api/adminServers';
import { getNodes, getNodeServerCount, type NodeListItem } from '@/api/nodes';
import { formatMib } from '@/lib/format';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { CapacityRack } from '@/pages/admin/nodes/CapacityRack';
import { ServersTable } from '@/pages/admin/servers/ServersTable';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { can } from '@/lib/can';

type ViewMode = 'nodes' | 'servers';
const EMPTY_NODES: NodeListItem[] = [];
const EMPTY_SERVERS: AdminServer[] = [];

function SummaryCell({ icon: Icon, label, value, sub }: { icon: typeof Server; label: string; value: string; sub?: string }) {
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

function ViewToggle({
    mode,
    onChange,
    available,
}: {
    mode: ViewMode;
    onChange: (m: ViewMode) => void;
    available: ViewMode[];
}) {
    const opts: { id: ViewMode; label: string; icon: typeof Server }[] = [
        { id: 'nodes', label: m['admin.infrastructure.view.nodes'](), icon: Server },
        { id: 'servers', label: m['admin.infrastructure.view.servers'](), icon: Layers },
    ];
    return (
        <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
            {opts.filter(option => available.includes(option.id)).map(o => (
                <button
                    key={o.id}
                    onClick={() => onChange(o.id)}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        mode === o.id
                            ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]',
                    )}
                >
                    <o.icon className="h-3.5 w-3.5" /> {o.label}
                </button>
            ))}
        </div>
    );
}

// "New" split button — both nodes and servers are created from the one menu.
// Items are gated on the matching create permission.
function NewMenu({ onNewServer, onNewNode }: { onNewServer: () => void; onNewNode: () => void }) {
    const held = useAdminHeld();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const canServer = can(held, 'servers.create');
    const canNode = can(held, 'nodes.create');

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    if (!canServer && !canNode) return null;

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
            >
                <Plus className="h-4 w-4" /> {m['admin.infrastructure.new.label']()}
                <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-lg shadow-black/20">
                    {canServer && (
                        <button
                            onClick={() => {
                                setOpen(false);
                                onNewServer();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                        >
                            <Layers className="h-4 w-4 text-[var(--color-ink-muted)]" /> {m['admin.infrastructure.new.server']()}
                        </button>
                    )}
                    {canNode && (
                        <button
                            onClick={() => {
                                setOpen(false);
                                onNewNode();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                        >
                            <Server className="h-4 w-4 text-[var(--color-ink-muted)]" /> {m['admin.infrastructure.new.node']()}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function FleetSummary({
    nodes,
    totalServers,
    activeServers,
    showNodes,
    showServers,
}: {
    nodes: NodeListItem[];
    totalServers: number | null;
    activeServers: number;
    showNodes: boolean;
    showServers: boolean;
}) {
    const supercharged = nodes.filter(n => n.wingsType === 'wings-rs').length;
    const maintenance = nodes.filter(n => n.maintenanceMode).length;
    const totalMemory = nodes.reduce((a, n) => a + n.memory, 0);
    const usedMemory = nodes.reduce((a, n) => a + n.allocatedMemory, 0);
    const totalDisk = nodes.reduce((a, n) => a + n.disk, 0);
    const usedDisk = nodes.reduce((a, n) => a + n.allocatedDisk, 0);

    return (
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
            {showNodes && (
                <>
                    <SummaryCell icon={Server} label={m['admin.infrastructure.summary.nodes']()} value={String(nodes.length)} sub={maintenance > 0 ? m['admin.infrastructure.summary.inMaintenance']({ count: maintenance }) : m['admin.infrastructure.summary.allOnline']()} />
                    <SummaryCell icon={Zap} label={m['admin.infrastructure.summary.supercharged']()} value={String(supercharged)} sub={m['admin.infrastructure.summary.standard']({ count: nodes.length - supercharged })} />
                </>
            )}
            {showServers && (
                <SummaryCell icon={Layers} label={m['admin.infrastructure.summary.servers']()} value={totalServers == null ? '—' : String(totalServers)} sub={m['admin.infrastructure.summary.active']({ count: activeServers })} />
            )}
            {showNodes && (
                <>
                    <SummaryCell icon={HardDrive} label={m['admin.infrastructure.summary.memory']()} value={formatMib(usedMemory)} sub={m['admin.infrastructure.summary.ofAllocated']({ size: formatMib(totalMemory) })} />
                    <SummaryCell icon={HardDrive} label={m['admin.infrastructure.summary.disk']()} value={formatMib(usedDisk)} sub={m['admin.infrastructure.summary.ofAllocated']({ size: formatMib(totalDisk) })} />
                </>
            )}
        </div>
    );
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Server; title: string; body: string }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
                <Icon className="h-6 w-6 text-[var(--color-ink-muted)]" />
            </div>
            <h3 className="text-lg font-medium">{title}</h3>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">{body}</p>
        </div>
    );
}

export default function InfrastructureOverviewPage() {
    const [stored, setMode] = usePersistedState<ViewMode>('v2:admin:infra:view', 'nodes');
    const navigate = useNavigate();
    const held = useAdminHeld();
    const canReadNodes = can(held, 'nodes.read');
    const canReadServers = can(held, 'servers.read');
    const availableModes: ViewMode[] = [];
    if (canReadNodes) availableModes.push('nodes');
    if (canReadServers) availableModes.push('servers');

    // The retired network map and the short-lived separate capacity view both left
    // their own values in localStorage; anything unrecognised falls back to the default.
    const requestedMode: ViewMode = stored === 'servers' ? 'servers' : 'nodes';
    const mode: ViewMode = availableModes.includes(requestedMode)
        ? requestedMode
        : canReadNodes
          ? 'nodes'
          : 'servers';

    // Honor a `?view=` deep link once (e.g. the admin overview's server/node tiles),
    // then strip the param so the persisted choice owns the view from there on.
    const [searchParams, setSearchParams] = useSearchParams();
    useEffect(() => {
        const requested = searchParams.get('view');
        if (
            (requested === 'servers' && canReadServers) ||
            (requested === 'nodes' && canReadNodes)
        ) {
            setMode(requested);
            searchParams.delete('view');
            setSearchParams(searchParams, { replace: true });
        }
        // Deliberately mount-only: a deep link should set the initial view, not fight
        // the user's subsequent toggles.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const serversQ = useQuery({
        queryKey: ['admin', 'servers'],
        queryFn: getAdminServers,
        enabled: canReadServers,
    });
    const nodesQ = useQuery({
        queryKey: ['admin', 'nodes'],
        queryFn: getNodes,
        enabled: canReadNodes,
    });

    const nodes = canReadNodes ? nodesQ.data : EMPTY_NODES;
    const servers = canReadServers ? serversQ.data : EMPTY_SERVERS;
    const isLoading = (canReadServers && serversQ.isLoading) || (canReadNodes && nodesQ.isLoading);
    const isError = (canReadServers && serversQ.isError) || (canReadNodes && nodesQ.isError);

    // Per-node server counts in parallel (mirrors the dashboard's useQueries pattern).
    const countQueries = useQueries({
        queries: (nodes ?? []).map(n => ({
            queryKey: ['admin', 'node-server-count', n.id],
            queryFn: () => getNodeServerCount(n.id),
            enabled: canReadNodes && !!nodes,
            staleTime: 30_000,
        })),
    });

    const countById = useMemo(() => {
        const map = new Map<number, number>();
        (nodes ?? []).forEach((n, i) => {
            const c = countQueries[i]?.data;
            if (typeof c === 'number') map.set(n.id, c);
        });
        return map;
    }, [nodes, countQueries]);

    const totalServers = canReadNodes
        ? nodes && countQueries.every(q => typeof q.data === 'number')
            ? countQueries.reduce((a, q) => a + (q.data ?? 0), 0)
            : null
        : servers?.length ?? null;
    const activeServers = useMemo(() => (servers ?? []).filter(s => s.state === 'active').length, [servers]);

    return (
        <div className="relative flex flex-col gap-4">
            <div className="bg-grid pointer-events-none absolute inset-x-0 -top-6 h-72 -z-10 opacity-60" />

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['admin.infrastructure.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.infrastructure.subtitle']()}</p>
                </div>
                <div className="flex items-center gap-2">
                    {availableModes.length > 1 && (
                        <ViewToggle mode={mode} onChange={setMode} available={availableModes} />
                    )}
                    <NewMenu
                        onNewServer={() => navigate('/admin/infrastructure/servers/new')}
                        onNewNode={() => navigate('/admin/infrastructure/nodes/new')}
                    />
                </div>
            </div>

            {isLoading && (
                <div className="flex items-center justify-center py-24">
                    <Spinner className="h-7 w-7" />
                </div>
            )}

            {isError && (
                <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                    {m['admin.infrastructure.loadError']()}
                </div>
            )}

            {!isLoading && !isError && nodes && servers && (
                <>
                    <FleetSummary
                        nodes={nodes}
                        totalServers={totalServers}
                        activeServers={activeServers}
                        showNodes={canReadNodes}
                        showServers={canReadServers}
                    />

                    {mode === 'servers' ? (
                        servers.length === 0 ? (
                            <EmptyState icon={Layers} title={m['admin.servers.empty.title']()} body={m['admin.servers.empty.body']()} />
                        ) : (
                            <ServersTable servers={servers} />
                        )
                    ) : nodes.length === 0 ? (
                        <EmptyState icon={Server} title={m['admin.nodes.empty.title']()} body={m['admin.nodes.empty.body']()} />
                    ) : (
                        <CapacityRack nodes={nodes} servers={servers} countById={countById} updatedAt={nodesQ.dataUpdatedAt} />
                    )}
                </>
            )}
        </div>
    );
}
