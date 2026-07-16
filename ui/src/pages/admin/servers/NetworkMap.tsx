import { m, td } from '@/i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Database,
    Server as ServerIcon,
    Hand,
    Mouse,
    MousePointerClick,
    ZoomIn,
    Search,
    Maximize2,
    Plus,
    Minus,
    Activity,
    Cpu,
    MemoryStick,
    HardDrive,
} from 'lucide-react';
import type { NodeListItem } from '@/api/nodes';
import type { AdminServer } from '@/api/adminServers';
import { useFlags } from '@/state/flags';
import { formatMib, timeAgo } from '@/lib/format';
import { SERVER_STATE } from './serverState';

// ── Geometry ────────────────────────────────────────────────────────────────
const PANEL_R = 34;
const NODE_R = 26;
const SERVER_R = 14;

interface GNode {
    kind: 'node';
    node: NodeListItem;
    x: number;
    y: number;
    serverCount: number;
}
interface GServer {
    kind: 'server';
    server: AdminServer;
    x: number;
    y: number;
}
interface GEdge {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    nodeId: number;
    serverId?: number;
}
type Hover = GNode | GServer | null;

function buildGraph(nodes: NodeListItem[], byNode: Map<number, AdminServer[]>) {
    const gnodes: GNode[] = [];
    const gservers: GServer[] = [];
    const edges: GEdge[] = [];
    const N = Math.max(1, nodes.length);
    const rNode = Math.max(340, N * 92);

    nodes.forEach((node, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / N;
        const nx = rNode * Math.cos(ang);
        const ny = rNode * Math.sin(ang);
        const servers = byNode.get(node.id) ?? [];
        gnodes.push({ kind: 'node', node, x: nx, y: ny, serverCount: servers.length });
        edges.push({ x1: 0, y1: 0, x2: nx, y2: ny, nodeId: node.id });

        const c = servers.length;
        const rServer = Math.max(150, (c * 50) / (2 * Math.PI));
        servers.forEach((server, j) => {
            // Fan the servers in a full ring, biased to open away from the centre.
            const sa = ang - Math.PI / 2 + ((j + 0.5) * 2 * Math.PI) / Math.max(1, c);
            const sx = nx + rServer * Math.cos(sa);
            const sy = ny + rServer * Math.sin(sa);
            gservers.push({ kind: 'server', server, x: sx, y: sy });
            edges.push({ x1: nx, y1: ny, x2: sx, y2: sy, nodeId: node.id, serverId: server.id });
        });
    });

    // Bounding box across everything (panel sits at origin).
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (const p of [...gnodes, ...gservers]) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return { gnodes, gservers, edges, bbox: { minX, minY, maxX, maxY } };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface View {
    k: number;
    tx: number;
    ty: number;
}

export function NetworkMap({
    nodes,
    servers,
    updatedAt,
}: {
    nodes: NodeListItem[];
    servers: AdminServer[];
    updatedAt: number;
}) {
    const navigate = useNavigate();
    const panelName = useFlags(s => s.site?.name) ?? 'Panel';

    const byNode = useMemo(() => {
        const m = new Map<number, AdminServer[]>();
        for (const s of servers) (m.get(s.nodeId) ?? m.set(s.nodeId, []).get(s.nodeId)!).push(s);
        return m;
    }, [servers]);

    const graph = useMemo(() => buildGraph(nodes, byNode), [nodes, byNode]);

    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
    const [smooth, setSmooth] = useState(false);
    const [hover, setHover] = useState<Hover>(null);
    const [query, setQuery] = useState('');
    const didFit = useRef(false);

    // Track container size.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const r = entries[0]?.contentRect;
            if (r) setSize({ w: r.width, h: r.height });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const fit = (animate = false) => {
        const { bbox } = graph;
        if (size.w === 0 || size.h === 0) return;
        const pad = 90;
        const bw = bbox.maxX - bbox.minX + pad * 2;
        const bh = bbox.maxY - bbox.minY + pad * 2;
        const k = clamp(Math.min(size.w / bw, size.h / bh), 0.15, 2);
        const cx = (bbox.minX + bbox.maxX) / 2;
        const cy = (bbox.minY + bbox.maxY) / 2;
        setSmooth(animate);
        setView({ k, tx: size.w / 2 - cx * k, ty: size.h / 2 - cy * k });
    };

    // Initial fit once size + graph are known.
    useEffect(() => {
        if (!didFit.current && size.w > 0 && size.h > 0) {
            didFit.current = true;
            fit(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size.w, size.h, graph]);

    // Zoom centred on a screen point.
    const zoomAround = (sx: number, sy: number, factor: number) => {
        setSmooth(false);
        setView(v => {
            const k = clamp(v.k * factor, 0.2, 3);
            const gx = (sx - v.tx) / v.k;
            const gy = (sy - v.ty) / v.k;
            return { k, tx: sx - gx * k, ty: sy - gy * k };
        });
    };

    // Non-passive wheel listener so we can preventDefault the page scroll.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = svg.getBoundingClientRect();
            zoomAround(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, []);

    // Drag-to-pan.
    const drag = useRef({ active: false, sx: 0, sy: 0, tx: 0, ty: 0, moved: false });
    const onPointerDown = (e: React.PointerEvent) => {
        drag.current = { active: true, sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setSmooth(false);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!drag.current.active) return;
        const dx = e.clientX - drag.current.sx;
        const dy = e.clientY - drag.current.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
        setView(v => ({ ...v, tx: drag.current.tx + dx, ty: drag.current.ty + dy }));
    };
    const onPointerUp = () => {
        drag.current.active = false;
    };

    const focusOn = (x: number, y: number) => {
        setSmooth(true);
        const k = Math.max(view.k, 1.1);
        setView({ k, tx: size.w / 2 - x * k, ty: size.h / 2 - y * k });
    };

    // ── Search matching ──────────────────────────────────────────────────────
    const q = query.trim().toLowerCase();
    const match = useMemo(() => {
        if (!q) return null;
        const serverIds = new Set<number>();
        const nodeIds = new Set<number>();
        for (const s of servers) {
            if (s.name.toLowerCase().includes(q)) {
                serverIds.add(s.id);
                nodeIds.add(s.nodeId);
            }
        }
        for (const n of nodes) if (n.name.toLowerCase().includes(q)) nodeIds.add(n.id);
        return { serverIds, nodeIds };
    }, [q, servers, nodes]);

    const nodeDim = (id: number) => (match ? !match.nodeIds.has(id) : false);
    const serverDim = (s: AdminServer) => (match ? !match.serverIds.has(s.id) : false);

    const edgeActive = (e: GEdge) => {
        if (!hover) return false;
        if (hover.kind === 'node') return e.nodeId === hover.node.id;
        return e.serverId === hover.server.id || (e.nodeId === hover.server.nodeId && e.serverId === undefined);
    };

    // Stats for the side panel.
    const stats = useMemo(() => {
        const maint = nodes.filter(n => n.maintenanceMode).length;
        const suspended = servers.filter(s => s.state === 'suspended').length;
        const active = servers.filter(s => s.state === 'active').length;
        const memory = servers.reduce((a, s) => a + s.limits.memory, 0);
        return { nodes: nodes.length, maint, servers: servers.length, suspended, active, connections: graph.edges.length, memory };
    }, [nodes, servers, graph.edges.length]);

    // Hover tooltip position (screen space).
    const hoverScreen = hover ? { x: hover.x * view.k + view.tx, y: hover.y * view.k + view.ty } : null;

    const groupStyle: React.CSSProperties = {
        transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`,
        transition: smooth ? 'transform 0.45s cubic-bezier(0.22,1,0.36,1)' : 'none',
    };

    return (
        <div
            ref={containerRef}
            className="relative h-[74vh] min-h-[560px] w-full overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/30"
        >
            <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />

            <svg
                ref={svgRef}
                width={size.w}
                height={size.h}
                className="absolute inset-0 touch-none select-none"
                style={{ cursor: drag.current.active ? 'grabbing' : 'grab' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                <g style={groupStyle}>
                    {/* Edges */}
                    {graph.edges.map((e, i) => {
                        const active = edgeActive(e);
                        const dim = match ? !match.nodeIds.has(e.nodeId) || (e.serverId != null && !match.serverIds.has(e.serverId)) : false;
                        return (
                            <line
                                key={i}
                                x1={e.x1}
                                y1={e.y1}
                                x2={e.x2}
                                y2={e.y2}
                                stroke={active ? 'var(--color-accent)' : 'var(--color-border-strong)'}
                                strokeWidth={active ? 2 : 1}
                                opacity={dim ? 0.08 : active ? 1 : 0.45}
                            />
                        );
                    })}

                    {/* Panel hub (centre) */}
                    <g>
                        <circle r={PANEL_R + 7} fill="var(--color-accent)" opacity={0.08} />
                        <circle r={PANEL_R} fill="var(--color-surface-2)" stroke="var(--color-accent)" strokeWidth={2.5} />
                        <foreignObject x={-16} y={-16} width={32} height={32}>
                            <div className="flex h-8 w-8 items-center justify-center text-[var(--color-accent)]">
                                <Database className="h-5 w-5" />
                            </div>
                        </foreignObject>
                        <text y={PANEL_R + 22} textAnchor="middle" className="fill-[var(--color-ink)] font-semibold" style={{ fontSize: 16 }}>
                            {panelName}
                        </text>
                    </g>

                    {/* Node hubs */}
                    {graph.gnodes.map(n => {
                        const ring = n.node.maintenanceMode ? 'var(--color-warning)' : 'var(--color-accent)';
                        const dim = nodeDim(n.node.id);
                        const isHover = hover?.kind === 'node' && hover.node.id === n.node.id;
                        return (
                            <g
                                key={`n-${n.node.id}`}
                                transform={`translate(${n.x} ${n.y})`}
                                opacity={dim ? 0.2 : 1}
                                className="cursor-pointer"
                                onMouseEnter={() => setHover(n)}
                                onMouseLeave={() => setHover(h => (h === n ? null : h))}
                                onClick={() => !drag.current.moved && focusOn(n.x, n.y)}
                                onDoubleClick={() => navigate(`/admin/infrastructure/nodes/${n.node.id}`)}
                            >
                                {isHover && <circle r={NODE_R + 8} fill={ring} opacity={0.12} />}
                                <circle r={NODE_R} fill="var(--color-surface-2)" stroke={ring} strokeWidth={2.25} />
                                <foreignObject x={-13} y={-13} width={26} height={26}>
                                    <div className="flex h-[26px] w-[26px] items-center justify-center text-[var(--color-ink-muted)]">
                                        <ServerIcon className="h-3.5 w-3.5" />
                                    </div>
                                </foreignObject>
                                <text y={NODE_R + 18} textAnchor="middle" className="fill-[var(--color-ink)] font-medium" style={{ fontSize: 13 }}>
                                    {n.node.name}
                                </text>
                                <text y={NODE_R + 33} textAnchor="middle" className="fill-[var(--color-ink-faint)]" style={{ fontSize: 11 }}>
                                    {n.serverCount} server{n.serverCount === 1 ? '' : 's'}
                                </text>
                                {n.node.wingsType === 'wings-rs' && (
                                    <text y={-NODE_R - 10} textAnchor="middle" className="fill-[var(--color-accent)] font-mono" style={{ fontSize: 9, letterSpacing: 1 }}>
                                        SUPERCHARGED
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* Server dots */}
                    {graph.gservers.map(s => {
                        const color = SERVER_STATE[s.server.state].color;
                        const dim = serverDim(s.server);
                        const isHover = hover?.kind === 'server' && hover.server.id === s.server.id;
                        return (
                            <g
                                key={`s-${s.server.id}`}
                                transform={`translate(${s.x} ${s.y})`}
                                opacity={dim ? 0.2 : 1}
                                className="cursor-pointer"
                                onMouseEnter={() => setHover(s)}
                                onMouseLeave={() => setHover(h => (h === s ? null : h))}
                                onClick={() => !drag.current.moved && navigate(`/admin/infrastructure/servers/${s.server.id}`)}
                            >
                                {isHover && <circle r={SERVER_R + 7} fill={color} opacity={0.18} />}
                                <circle r={SERVER_R} fill={color} stroke="var(--color-surface)" strokeWidth={2.5} />
                                <text y={SERVER_R + 16} textAnchor="middle" className="fill-[var(--color-ink-muted)]" style={{ fontSize: 12 }}>
                                    {s.server.name}
                                </text>
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* Hover detail card */}
            {hover && hoverScreen && (
                <div
                    className="pointer-events-none absolute z-20 w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl"
                    style={{ left: clamp(hoverScreen.x, 120, size.w - 120), top: clamp(hoverScreen.y - 20, 90, size.h) }}
                >
                    {hover.kind === 'server' ? (
                        <>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: SERVER_STATE[hover.server.state].color }} />
                                <span className="truncate text-sm font-semibold text-[var(--color-ink)]">{hover.server.name}</span>
                            </div>
                            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-faint)]">
                                {m['admin.servers.map.serverMeta']({ state: td(`admin.servers.state.${hover.server.state}`, SERVER_STATE[hover.server.state].label), node: hover.server.nodeName ?? `node #${hover.server.nodeId}` })}
                            </p>
                            <div className="mt-2 grid grid-cols-3 gap-1 border-t border-[var(--color-border)] pt-2 font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                                <span className="flex items-center gap-1"><Cpu className="h-3 w-3 text-[var(--color-ink-faint)]" />{hover.server.limits.cpu > 0 ? `${hover.server.limits.cpu}%` : '∞'}</span>
                                <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3 text-[var(--color-ink-faint)]" />{formatMib(hover.server.limits.memory)}</span>
                                <span className="flex items-center gap-1"><HardDrive className="h-3 w-3 text-[var(--color-ink-faint)]" />{formatMib(hover.server.limits.disk)}</span>
                            </div>
                            <p className="mt-2 text-[10px] text-[var(--color-ink-faint)]">{m['admin.servers.map.clickOpenOwner']({ owner: hover.server.ownerName ?? `#${hover.server.ownerId}` })}</p>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: hover.node.maintenanceMode ? 'var(--color-warning)' : 'var(--color-accent)' }} />
                                <span className="truncate text-sm font-semibold text-[var(--color-ink)]">{hover.node.name}</span>
                            </div>
                            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-faint)]">{hover.node.fqdn}</p>
                            <div className="mt-2 flex items-center justify-between border-t border-[var(--color-border)] pt-2 font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                                <span>{m['admin.servers.map.serverCount']({ count: hover.serverCount })}</span>
                                <span>{m['admin.servers.map.memShort']({ size: formatMib(hover.node.allocatedMemory) })}</span>
                            </div>
                            <p className="mt-2 text-[10px] text-[var(--color-ink-faint)]">{m['admin.servers.map.clickFocusNode']()}</p>
                        </>
                    )}
                </div>
            )}

            {/* Legend + controls + stats */}
            <div className="pointer-events-none absolute left-4 top-4 hidden w-52 flex-col gap-3 sm:flex">
                <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/85 p-3 backdrop-blur">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{m['admin.servers.map.legend']()}</p>
                    <div className="flex flex-col gap-1.5 text-xs text-[var(--color-ink-muted)]">
                        <LegendRow swatch={<RingSwatch color="var(--color-accent)" />} label={m['admin.servers.map.activeNode']()} />
                        <LegendRow swatch={<RingSwatch color="var(--color-warning)" />} label={m['admin.servers.map.maintenanceNode']()} />
                        <LegendRow swatch={<DotSwatch color="var(--color-accent)" />} label={m['admin.servers.map.server']()} />
                        <LegendRow swatch={<DotSwatch color="var(--color-danger)" />} label={m['admin.servers.map.suspendedServer']()} />
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/85 p-3 backdrop-blur">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{m['admin.servers.map.controls']()}</p>
                    <div className="flex flex-col gap-1.5 text-[11px] text-[var(--color-ink-muted)]">
                        <ControlRow icon={Hand} label={m['admin.servers.map.dragToPan']()} />
                        <ControlRow icon={Mouse} label={m['admin.servers.map.scrollToZoom']()} />
                        <ControlRow icon={MousePointerClick} label={m['admin.servers.map.clickFocus']()} />
                        <ControlRow icon={ZoomIn} label={m['admin.servers.map.doubleClickOpen']()} />
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/85 p-3 backdrop-blur">
                    <StatRow icon={ServerIcon} label={m['admin.servers.map.nodes']()} value={String(stats.nodes)} sub={stats.maint > 0 ? m['admin.servers.map.inMaintenance']({ count: stats.maint }) : m['admin.servers.map.allOnline']()} />
                    <StatRow icon={Database} label={m['admin.servers.map.servers']()} value={String(stats.servers)} sub={m['admin.servers.map.activeSuspended']({ active: stats.active, suspended: stats.suspended })} />
                    <StatRow icon={Activity} label={m['admin.servers.map.connections']()} value={String(stats.connections)} />
                    <StatRow icon={MemoryStick} label={m['admin.servers.map.memory']()} value={formatMib(stats.memory)} sub={m['admin.servers.map.allocated']()} last />
                    <p className="mt-2 flex items-center gap-1.5 border-t border-[var(--color-border)] pt-2 font-mono text-[10px] text-[var(--color-ink-faint)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /> {m['admin.servers.map.updated']({ ago: timeAgo(updatedAt) })}
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="absolute right-4 top-4 flex items-center">
                <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/85 px-3 backdrop-blur">
                    <Search className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={m['admin.servers.map.search']()}
                        className="h-9 w-48 bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
                    />
                </div>
            </div>

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 flex flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/85 backdrop-blur">
                <ZoomButton onClick={() => zoomAround(size.w / 2, size.h / 2, 1.2)}><Plus className="h-4 w-4" /></ZoomButton>
                <ZoomButton onClick={() => zoomAround(size.w / 2, size.h / 2, 1 / 1.2)} border><Minus className="h-4 w-4" /></ZoomButton>
                <ZoomButton onClick={() => fit(true)} border><Maximize2 className="h-4 w-4" /></ZoomButton>
            </div>

            {/* Minimap */}
            <Minimap graph={graph} view={view} size={size} />
        </div>
    );
}

// ── Small presentational helpers ─────────────────────────────────────────────
function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
    return (
        <div className="flex items-center gap-2">
            {swatch}
            <span>{label}</span>
        </div>
    );
}
function RingSwatch({ color }: { color: string }) {
    return <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: color }} />;
}
function DotSwatch({ color }: { color: string }) {
    return <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}
function ControlRow({ icon: Icon, label }: { icon: typeof Hand; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
            <span>{label}</span>
        </div>
    );
}
function StatRow({ icon: Icon, label, value, sub, last }: { icon: typeof Hand; label: string; value: string; sub?: string; last?: boolean }) {
    return (
        <div className={`flex items-center gap-2.5 py-1.5 ${last ? '' : 'border-b border-[var(--color-border)]'}`}>
            <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
            <div className="min-w-0 flex-1">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{label}</p>
                {sub && <p className="font-mono text-[10px] text-[var(--color-ink-faint)]">{sub}</p>}
            </div>
            <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">{value}</span>
        </div>
    );
}
function ZoomButton({ children, onClick, border }: { children: React.ReactNode; onClick: () => void; border?: boolean }) {
    return (
        <button
            onClick={onClick}
            className={`flex h-9 w-9 items-center justify-center text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] ${border ? 'border-t border-[var(--color-border)]' : ''}`}
        >
            {children}
        </button>
    );
}

function Minimap({ graph, view, size }: { graph: ReturnType<typeof buildGraph>; view: View; size: { w: number; h: number } }) {
    const MM_W = 168;
    const MM_H = 112;
    const pad = 10;
    const { bbox } = graph;
    const bw = bbox.maxX - bbox.minX || 1;
    const bh = bbox.maxY - bbox.minY || 1;
    const scale = Math.min((MM_W - pad * 2) / bw, (MM_H - pad * 2) / bh);
    const ox = pad - bbox.minX * scale + (MM_W - pad * 2 - bw * scale) / 2;
    const oy = pad - bbox.minY * scale + (MM_H - pad * 2 - bh * scale) / 2;
    const mx = (gx: number) => gx * scale + ox;
    const my = (gy: number) => gy * scale + oy;

    // Visible graph region (inverse of the view transform).
    const vx1 = (0 - view.tx) / view.k;
    const vy1 = (0 - view.ty) / view.k;
    const vx2 = (size.w - view.tx) / view.k;
    const vy2 = (size.h - view.ty) / view.k;

    return (
        <div className="absolute bottom-4 left-4 hidden overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/85 backdrop-blur sm:block">
            <svg width={MM_W} height={MM_H}>
                {graph.gnodes.map(n => (
                    <circle key={`mn-${n.node.id}`} cx={mx(n.x)} cy={my(n.y)} r={3} fill="var(--color-ink-muted)" />
                ))}
                {graph.gservers.map(s => (
                    <circle key={`ms-${s.server.id}`} cx={mx(s.x)} cy={my(s.y)} r={1.8} fill={SERVER_STATE[s.server.state].color} />
                ))}
                <rect
                    x={mx(vx1)}
                    y={my(vy1)}
                    width={(vx2 - vx1) * scale}
                    height={(vy2 - vy1) * scale}
                    fill="var(--color-accent)"
                    fillOpacity={0.08}
                    stroke="var(--color-accent)"
                    strokeWidth={1}
                />
            </svg>
        </div>
    );
}
