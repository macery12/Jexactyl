import { m } from '@/i18n';
import { Link } from 'react-router-dom';
import { Server, Wrench, Globe, Lock } from 'lucide-react';
import type { NodeListItem } from '@/api/nodes';
import { formatMib } from '@/lib/format';
import { Badge, SuperchargedBadge } from './NodeBadges';
import { cn } from '@/lib/cn';

function CapacityBar({ label, used, total, overallocate }: { label: string; used: number; total: number; overallocate: number }) {
    // total is the base limit (MiB). Overallocate (%) raises the effective ceiling.
    const ceiling = total > 0 ? total * (1 + Math.max(0, overallocate) / 100) : 0;
    const percent = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 0;
    const basePercent = ceiling > 0 ? Math.min(100, (total / ceiling) * 100) : 100;
    const tone = percent >= 90 ? 'bg-[var(--color-danger)]' : percent >= 70 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-accent)]';

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                    {label}
                </span>
                <span className="text-[var(--color-ink-muted)]">
                    {formatMib(used)} <span className="text-[var(--color-ink-faint)]">/ {total > 0 ? formatMib(total) : '∞'}</span>
                </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className={cn('h-full transition-all duration-500', tone)} style={{ width: `${percent}%` }} />
                {/* Hairline marker for the non-overallocated base limit. */}
                {overallocate > 0 && total > 0 && (
                    <span
                        className="absolute top-0 h-full w-px bg-[var(--color-ink-faint)]"
                        style={{ left: `${basePercent}%` }}
                        title="Base limit (before overallocation)"
                    />
                )}
            </div>
        </div>
    );
}

export function NodeCard({ node, serverCount }: { node: NodeListItem; serverCount: number | null }) {
    return (
        <Link
            to={`/admin/infrastructure/nodes/${node.id}`}
            className="group flex flex-col gap-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-4 transition-colors hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]/40"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                            {node.name}
                        </h3>
                        {node.maintenanceMode && (
                            <Badge tone="warning">
                                <Wrench className="h-2.5 w-2.5" /> {m['admin.nodes.card.maint']()}
                            </Badge>
                        )}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink-faint)]">{node.fqdn}</p>
                </div>
                <SuperchargedBadge wingsType={node.wingsType} />
            </div>

            <div className="flex flex-col gap-2">
                <CapacityBar label={m['common.metrics.memory']()} used={node.allocatedMemory} total={node.memory} overallocate={node.memoryOverallocate} />
                <CapacityBar label={m['common.metrics.disk']()} used={node.allocatedDisk} total={node.disk} overallocate={node.diskOverallocate} />
            </div>

            <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2.5 text-[11px]">
                <span className="flex items-center gap-1.5 font-mono tabular-nums text-[var(--color-ink-muted)]">
                    <Server className="h-3 w-3" />
                    {serverCount == null ? '—' : m['admin.nodes.card.serverCount']({ count: serverCount })}
                </span>
                <span className="flex items-center gap-1.5 text-[var(--color-ink-faint)]">
                    {node.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {node.isPublic ? m['admin.nodes.public']() : m['admin.nodes.private']()}
                </span>
            </div>
        </Link>
    );
}
