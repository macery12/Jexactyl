import { m } from '@/i18n/messages';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Server as ServerIcon } from 'lucide-react';
import type { NodeListItem } from '@/api/nodes';
import type { AdminServer } from '@/api/adminServers';
import { formatMib, timeAgo } from '@/lib/format';
import { SuperchargedBadge } from './NodeBadges';
import { cn } from '@/lib/cn';

// Capacity is measured the same way the node cards measure it: allocation (the
// sum of the limits of every server placed on the node) against the base limit,
// with overallocation raising the ceiling the bar is drawn in. A node past 100%
// of its base limit is running on borrowed room, which is the thing this view
// exists to make visible without a click.
type Tone = 'over' | 'near' | 'ok' | 'maint';

interface Track {
    /** Allocation as a percentage of the BASE limit — can exceed 100. */
    percent: number;
    /** Width of the drawn bar, as a percentage of the (possibly extended) track. */
    fill: number;
    /** Where the base limit sits in the track, when overallocation extends it. */
    basePercent: number;
    unlimited: boolean;
    allocated: number;
    total: number;
}

function track(allocated: number, total: number, overallocate: number): Track {
    if (total <= 0) {
        return { percent: 0, fill: 0, basePercent: 100, unlimited: true, allocated, total };
    }
    const ceiling = total * (1 + Math.max(0, overallocate) / 100);
    return {
        percent: (allocated / total) * 100,
        fill: Math.min(100, (allocated / ceiling) * 100),
        basePercent: Math.min(100, (total / ceiling) * 100),
        unlimited: false,
        allocated,
        total,
    };
}

function toneFor(percent: number): Exclude<Tone, 'maint'> {
    if (percent >= 100) return 'over';
    if (percent >= 90) return 'near';
    return 'ok';
}

const BAR: Record<Tone, string> = {
    over: 'bg-[var(--color-danger)]',
    near: 'bg-[var(--color-warning)]',
    ok: 'bg-[var(--color-accent)]',
    maint: 'bg-[var(--color-ink-faint)]',
};

const STRIPE: Record<Tone, string> = {
    over: 'bg-[var(--color-danger)]',
    near: 'bg-[var(--color-warning)]',
    ok: 'bg-[var(--color-accent)]',
    maint: 'bg-[var(--color-ink-faint)]',
};

const PILL: Record<Tone, string> = {
    over: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
    near: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
    ok: 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
    maint: 'border-[var(--color-border-strong)] text-[var(--color-ink-faint)]',
};

function statusLabel(tone: Tone): string {
    if (tone === 'maint') return m['admin.infrastructure.capacity.status.maintenance']();
    if (tone === 'over') return m['admin.infrastructure.capacity.status.overAllocated']();
    if (tone === 'near') return m['admin.infrastructure.capacity.status.nearCapacity']();
    return m['admin.infrastructure.capacity.status.available']();
}

function Meter({ label, data, tone }: { label: string; data: Track; tone: Tone }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
                {/* The column head carries the label once the row grid is in play. */}
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)] lg:hidden">
                    {label}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                    {data.unlimited ? (
                        m['admin.infrastructure.capacity.unlimited']()
                    ) : (
                        <>
                            {formatMib(data.allocated)}
                            <span className="text-[var(--color-ink-faint)]"> / {formatMib(data.total)}</span>
                            <span className="ml-1.5 text-[var(--color-ink-faint)]">{Math.round(data.percent)}%</span>
                        </>
                    )}
                </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                    className={cn('h-full transition-all duration-500', BAR[tone])}
                    style={{ width: `${data.fill}%` }}
                />
                {/* Hairline at the base limit when overallocation extends the track,
                    so "past the line" reads as borrowed room rather than headroom. */}
                {!data.unlimited && data.basePercent < 100 && (
                    <span
                        className="absolute top-0 h-full w-px bg-[var(--color-ink-faint)]"
                        style={{ left: `${data.basePercent}%` }}
                        title={m['admin.infrastructure.capacity.baseLimit']()}
                    />
                )}
            </div>
        </div>
    );
}

interface Row {
    node: NodeListItem;
    memory: Track;
    disk: Track;
    tone: Tone;
    pressure: number;
    servers: number | null;
    suspended: number;
}

export function CapacityRack({
    nodes,
    servers,
    countById,
    updatedAt,
}: {
    nodes: NodeListItem[];
    servers: AdminServer[];
    countById: Map<number, number>;
    updatedAt: number;
}) {
    const rows = useMemo<Row[]>(() => {
        const suspendedByNode = new Map<number, number>();
        for (const s of servers) {
            if (s.state === 'suspended') suspendedByNode.set(s.nodeId, (suspendedByNode.get(s.nodeId) ?? 0) + 1);
        }

        return nodes
            .map(node => {
                const memory = track(node.allocatedMemory, node.memory, node.memoryOverallocate);
                const disk = track(node.allocatedDisk, node.disk, node.diskOverallocate);
                const pressure = Math.max(memory.percent, disk.percent);
                return {
                    node,
                    memory,
                    disk,
                    tone: node.maintenanceMode ? ('maint' as Tone) : toneFor(pressure),
                    pressure,
                    servers: countById.has(node.id) ? countById.get(node.id)! : null,
                    suspended: suspendedByNode.get(node.id) ?? 0,
                };
            })
            .sort((a, b) => b.pressure - a.pressure);
    }, [nodes, servers, countById]);

    const strained = rows.filter(r => r.tone === 'over' || r.tone === 'near').length;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-xs text-[var(--color-ink-muted)]">
                    {strained > 0
                        ? m['admin.infrastructure.capacity.strained']({ count: strained, total: rows.length })
                        : m['admin.infrastructure.capacity.allHeadroom']()}
                </p>
                <p className="font-mono text-[11px] text-[var(--color-ink-faint)]">
                    {m['admin.infrastructure.capacity.updated']({ ago: timeAgo(updatedAt) })}
                </p>
            </div>

            {/* Column headers, hidden on narrow viewports where rows stack. Carries its
                own surface so it reads as a table head rather than floating on canvas. */}
            <div className="hidden grid-cols-[0.25rem_minmax(11rem,1.4fr)_9rem_minmax(9rem,1fr)_minmax(9rem,1fr)_6.5rem] items-center gap-x-4 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/60 py-2 pl-0 pr-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)] lg:grid">
                <span />
                <span>{m['admin.infrastructure.capacity.col.node']()}</span>
                <span>{m['admin.infrastructure.capacity.col.status']()}</span>
                <span>{m['common.metrics.memory']()}</span>
                <span>{m['common.metrics.disk']()}</span>
                <span className="text-right">{m['admin.infrastructure.capacity.col.servers']()}</span>
            </div>

            <div className="flex flex-col gap-2">
                {rows.map(row => (
                    <Link
                        key={row.node.id}
                        to={`/admin/infrastructure/nodes/${row.node.id}`}
                        className="group grid grid-cols-1 items-center gap-x-4 gap-y-3 overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 py-3 pl-4 pr-4 transition-colors hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]/40 lg:grid-cols-[0.25rem_minmax(11rem,1.4fr)_9rem_minmax(9rem,1fr)_minmax(9rem,1fr)_6.5rem] lg:pl-0"
                    >
                        {/* Severity rail: state reads as position and form, not only as
                            color. Bleeds through the row padding so it reads as an edge. */}
                        <span
                            className={cn('-my-3 hidden w-full self-stretch lg:block', STRIPE[row.tone])}
                            aria-hidden="true"
                        />

                        <div className="flex min-w-0 items-start gap-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="truncate text-sm font-semibold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                                        {row.node.name}
                                    </h3>
                                    <SuperchargedBadge wingsType={row.node.wingsType} />
                                </div>
                                <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink-faint)]">
                                    {row.node.fqdn}
                                </p>
                            </div>
                        </div>

                        <div>
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
                                    PILL[row.tone],
                                )}
                            >
                                {row.tone === 'maint' && <Wrench className="h-2.5 w-2.5" />}
                                {statusLabel(row.tone)}
                            </span>
                        </div>

                        <Meter label={m['common.metrics.memory']()} data={row.memory} tone={row.tone} />
                        <Meter label={m['common.metrics.disk']()} data={row.disk} tone={row.tone} />

                        <div className="flex items-center gap-1.5 font-mono tabular-nums lg:flex-col lg:items-end lg:gap-0">
                            <span className="text-base leading-none text-[var(--color-ink)]">
                                {row.servers == null ? '—' : row.servers}
                            </span>
                            <span className="flex items-center gap-1 text-[11px] text-[var(--color-ink-faint)] lg:mt-1">
                                <ServerIcon className="h-3 w-3 lg:hidden" />
                                {row.suspended > 0
                                    ? m['admin.infrastructure.capacity.suspendedCount']({ count: row.suspended })
                                    : m['admin.infrastructure.capacity.allRunning']()}
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
