import { m } from '@/i18n/messages';
import { type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
    Server,
    Boxes,
    Users,
    CircleDollarSign,
    LifeBuoy,
    AlertTriangle,
    Mail,
    ChevronRight,
    CheckCircle2,
    ArrowUp,
    Activity,
    Wrench,
    ListOrdered,
} from 'lucide-react';
import { getAdminOverview, type AdminOverview, type OverviewNode, type OverviewNodeResource } from '@/api/adminOverview';
import { useFlags } from '@/state/flags';
import { Spinner } from '@/components/ui/Spinner';
import { formatMib, formatCurrency, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
    type Tone,
    toneText,
    toneBar,
    panelClass,
    PanelHeader,
    LegendDot,
    KpiTile,
    StatusLine,
    type AttentionItem,
} from '../dashboardParts';

function QueueCard({
    icon: Icon,
    count,
    title,
    detail,
    tone,
    to,
}: {
    icon: ComponentType<{ className?: string }>;
    count: number;
    title: string;
    detail: string;
    tone: Tone;
    to: string;
}) {
    return (
        <Link
            to={to}
            className="relative flex items-center gap-3 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)]"
        >
            <span className={cn('absolute inset-y-0 left-0 w-[3px]', toneBar[tone])} />
            <Icon className={cn('h-4 w-4 shrink-0', toneText[tone])} />
            <span className={cn('font-mono text-2xl font-semibold tabular-nums', toneText[tone])}>{count}</span>
            <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-ink)]">{title}</span>
                <span className="block truncate text-xs text-[var(--color-ink-muted)]">{detail}</span>
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
        </Link>
    );
}

// 45° hatching signals "past a limit" without needing another flat color.
const hatch = (color: string) =>
    `repeating-linear-gradient(135deg, ${color} 0, ${color} 3px, transparent 3px, transparent 6px)`;

/**
 * Allocation bar for one node resource. The track's scale runs to whichever is
 * larger: physical capacity (100%), the configured overallocation ceiling, or
 * the actual allocation. Fill past the 100% tick renders hatched amber; fill
 * past the configured ceiling renders hatched red. Purely informational —
 * nothing is blocked.
 */
function NodeBar({ label, resource }: { label: string; resource: OverviewNodeResource }) {
    const { percent, limitPercent } = resource;
    const scaleMax = Math.max(100, limitPercent ?? 0, percent);

    const solidWidth = (Math.min(percent, 100) / scaleMax) * 100;
    const amberEnd = limitPercent === null ? percent : Math.min(percent, limitPercent);
    const amberWidth = (Math.max(0, amberEnd - 100) / scaleMax) * 100;
    const redWidth = limitPercent === null ? 0 : (Math.max(0, percent - limitPercent) / scaleMax) * 100;
    const capacityTick = (100 / scaleMax) * 100;

    const overCapacity = percent > 100;
    const overLimit = limitPercent !== null && percent > limitPercent;

    return (
        <div
            className="flex items-center gap-3"
            title={m['admin.overview.fleet.allocated']({
                memory: formatMib(resource.used),
                total: formatMib(resource.total),
            })}
        >
            <span className="w-9 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                {label}
            </span>
            <div className="relative h-2 flex-1 rounded-sm bg-[var(--color-surface-2)]">
                <div
                    className="absolute inset-y-0 left-0 rounded-l-sm bg-[var(--brand)]"
                    style={{ width: `${solidWidth}%` }}
                />
                {amberWidth > 0 && (
                    <div
                        className="absolute inset-y-0 bg-[var(--color-warning)]/25"
                        style={{
                            left: `${capacityTick}%`,
                            width: `${amberWidth}%`,
                            backgroundImage: hatch('var(--color-warning)'),
                        }}
                    />
                )}
                {redWidth > 0 && (
                    <div
                        className="absolute inset-y-0 bg-[var(--color-danger)]/25"
                        style={{
                            left: `${capacityTick + amberWidth}%`,
                            width: `${redWidth}%`,
                            backgroundImage: hatch('var(--color-danger)'),
                        }}
                    />
                )}
                {scaleMax > 100 && (
                    <div
                        className="absolute inset-y-[-2px] w-px bg-[var(--color-ink)]/70"
                        style={{ left: `${capacityTick}%` }}
                    />
                )}
            </div>
            <span
                className={cn(
                    'w-12 shrink-0 text-right font-mono text-xs font-semibold tabular-nums',
                    overLimit
                        ? 'text-[var(--color-danger)]'
                        : overCapacity
                          ? 'text-[var(--color-warning)]'
                          : 'text-[var(--color-ink-muted)]',
                )}
            >
                {percent}%
            </span>
        </div>
    );
}

function NodeRow({ node }: { node: OverviewNode }) {
    return (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
            <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-[var(--color-ink)]">{node.name}</span>
                {node.maintenance && (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-warning)]">
                        <Wrench className="h-3 w-3" />
                        {m['admin.overview.node.maintenance']()}
                    </span>
                )}
                <span className="ml-auto font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                    {m['admin.overview.node.servers']({ count: node.servers })}
                </span>
            </div>
            <NodeBar label={m['admin.overview.node.mem']()} resource={node.memory} />
            <NodeBar label={m['admin.overview.node.disk']()} resource={node.disk} />
        </div>
    );
}

function buildAttention(data: AdminOverview, billingEnabled: boolean, ticketsEnabled: boolean): AttentionItem[] {
    const items: AttentionItem[] = [];
    if (!data.health.version.isLatest && data.health.version.latest) {
        items.push({ key: 'update', label: m['admin.overview.attention.update']({ version: data.health.version.latest }), to: '/admin/settings' });
    }
    if (data.fleet.nodes.maintenance > 0) {
        items.push({ key: 'maint', label: m['admin.overview.attention.maintenance']({ count: data.fleet.nodes.maintenance }), to: '/admin/infrastructure' });
    }
    if (data.fleet.servers.installFailed > 0) {
        items.push({ key: 'install', label: m['admin.overview.attention.installFailed']({ count: data.fleet.servers.installFailed }), to: '/admin/infrastructure' });
    }
    if (ticketsEnabled && data.queues.tickets.pending > 0) {
        items.push({ key: 'tickets', label: m['admin.overview.attention.tickets']({ count: data.queues.tickets.pending }), to: '/admin/tickets' });
    }
    if (billingEnabled && data.queues.billingExceptions > 0) {
        items.push({ key: 'billing', label: m['admin.overview.attention.billing']({ count: data.queues.billingExceptions }), to: '/admin/billing' });
    }
    // A stalled queue means invoices, email and scheduled tasks have silently
    // stopped, so it belongs alongside the other things demanding action.
    if (data.workers.criticalWarnings > 0) {
        items.push({ key: 'workers', label: m['admin.overview.attention.workers'](), to: '/admin/queues' });
    }
    return items;
}

export default function OverviewPage() {
    const flags = useFlags(s => s.everest);
    const billingEnabled = flags?.billing.enabled ?? false;
    const ticketsEnabled = flags?.tickets.enabled ?? false;

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin', 'overview'],
        queryFn: getAdminOverview,
        refetchInterval: 30_000,
    });

    const nodes = data
        ? [...data.fleet.nodes.list].sort(
              (a, b) => Math.max(b.memory.percent, b.disk.percent) - Math.max(a.memory.percent, a.disk.percent),
          )
        : [];
    const shownNodes = nodes.slice(0, 6);

    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">{m['admin.overview.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.overview.subtitle']()}</p>
            </header>

            {isLoading && (
                <div className="flex items-center justify-center py-24">
                    <Spinner className="h-7 w-7" />
                </div>
            )}

            {isError && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                    {error instanceof Error ? error.message : m['common.states.genericError']()}
                </div>
            )}

            {data && (
                <>
                    <StatusLine
                        items={buildAttention(data, billingEnabled, ticketsEnabled)}
                        info={m['admin.overview.status.version']({ version: data.health.version.current })}
                    />

                    {/* KPI row */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <KpiTile
                            icon={Server}
                            label={m['admin.overview.kpi.servers']()}
                            value={String(data.fleet.servers.total)}
                            sub={m['admin.overview.kpi.serversActive']({ count: data.fleet.servers.active })}
                            to="/admin/infrastructure?view=servers"
                        />
                        <KpiTile
                            icon={Boxes}
                            label={m['admin.overview.kpi.nodes']()}
                            value={String(data.fleet.nodes.total)}
                            sub={m['admin.overview.kpi.nodesCapacity']({
                                percent: Math.max(data.fleet.capacity.memoryPercent, data.fleet.capacity.diskPercent),
                            })}
                            tone={data.fleet.nodes.maintenance > 0 ? 'warning' : undefined}
                            to="/admin/infrastructure?view=nodes"
                        />
                        <KpiTile
                            icon={Users}
                            label={m['admin.overview.kpi.users']()}
                            value={data.kpis.users.total.toLocaleString()}
                            sub={
                                data.kpis.users.newThisWeek > 0 ? (
                                    <span className="inline-flex items-center gap-0.5 text-[var(--color-accent)]">
                                        <ArrowUp className="h-3 w-3" />
                                        {m['admin.overview.kpi.usersNew']({ count: data.kpis.users.newThisWeek })}
                                    </span>
                                ) : undefined
                            }
                            to="/admin/access/users"
                        />
                        {billingEnabled ? (
                            <KpiTile
                                icon={CircleDollarSign}
                                label={m['admin.overview.kpi.mrr']()}
                                value={formatCurrency(data.kpis.revenue.monthlyRecurring)}
                                tone="accent"
                                to="/admin/billing"
                            />
                        ) : (
                            <KpiTile
                                icon={LifeBuoy}
                                label={m['admin.overview.kpi.openTickets']()}
                                value={String(data.queues.tickets.pending + data.queues.tickets.inProgress)}
                                tone={data.queues.tickets.pending > 0 ? 'warning' : undefined}
                                to={ticketsEnabled ? '/admin/tickets' : undefined}
                            />
                        )}
                    </div>

                    {/* Fleet board + right rail */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <section className={panelClass('lg:col-span-2')}>
                            <PanelHeader
                                title={m['admin.overview.section.fleetHealth']()}
                                to="/admin/infrastructure"
                                action={m['admin.overview.link.infrastructure']()}
                            />
                            <div className="mb-3 flex h-2 overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
                                <div
                                    className="h-full bg-[var(--color-accent)]"
                                    style={{ width: `${pct(data.fleet.servers.active, data.fleet.servers.total)}%` }}
                                />
                                <div
                                    className="h-full bg-[var(--color-warning)]"
                                    style={{ width: `${pct(data.fleet.servers.suspended, data.fleet.servers.total)}%` }}
                                />
                                <div
                                    className="h-full bg-[var(--color-danger)]"
                                    style={{ width: `${pct(data.fleet.servers.installFailed, data.fleet.servers.total)}%` }}
                                />
                            </div>
                            <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--color-ink-muted)]">
                                <LegendDot color="var(--color-accent)" label={m['admin.overview.fleet.active']({ count: data.fleet.servers.active })} />
                                <LegendDot color="var(--color-warning)" label={m['admin.overview.fleet.suspended']({ count: data.fleet.servers.suspended })} />
                                {data.fleet.servers.installFailed > 0 && (
                                    <LegendDot color="var(--color-danger)" label={m['admin.overview.fleet.installFailed']({ count: data.fleet.servers.installFailed })} />
                                )}
                            </div>

                            <div className="flex flex-col gap-3">
                                {shownNodes.map(node => (
                                    <NodeRow key={node.id} node={node} />
                                ))}
                            </div>
                            {nodes.length > shownNodes.length && (
                                <Link
                                    to="/admin/infrastructure?view=nodes"
                                    className="mt-3 block font-mono text-xs text-[var(--brand-bright)] hover:underline"
                                >
                                    {m['admin.overview.node.more']({ count: nodes.length - shownNodes.length })}
                                </Link>
                            )}
                            <p className="mt-4 border-t border-[var(--color-border)] pt-3 font-mono text-xs text-[var(--color-ink-faint)]">
                                {m['admin.overview.fleet.allocated']({
                                    memory: formatMib(data.fleet.capacity.memoryUsed),
                                    total: formatMib(data.fleet.capacity.memoryTotal),
                                })}
                            </p>
                        </section>

                        <aside className="flex flex-col gap-4">
                            {/* Work queue */}
                            <div className={panelClass()}>
                                <PanelHeader title={m['admin.overview.section.workQueue']()} />
                                <div className="flex flex-col gap-2.5">
                                    {ticketsEnabled && data.queues.tickets.pending > 0 && (
                                        <QueueCard
                                            icon={LifeBuoy}
                                            count={data.queues.tickets.pending}
                                            title={m['admin.overview.queue.tickets']()}
                                            detail={m['admin.overview.queue.ticketsSub']({ count: data.queues.tickets.inProgress })}
                                            tone="warning"
                                            to="/admin/tickets"
                                        />
                                    )}
                                    {billingEnabled && data.queues.billingExceptions > 0 && (
                                        <QueueCard
                                            icon={AlertTriangle}
                                            count={data.queues.billingExceptions}
                                            title={m['admin.overview.queue.exceptions']()}
                                            detail={m['admin.overview.queue.exceptionsSub']()}
                                            tone="danger"
                                            to="/admin/billing"
                                        />
                                    )}
                                    {data.workers.criticalWarnings > 0 && (
                                        <QueueCard
                                            icon={ListOrdered}
                                            count={data.workers.depth}
                                            title={m['admin.overview.queue.workers']()}
                                            detail={data.workers.summary ?? m['admin.overview.queue.workersSub']()}
                                            tone="danger"
                                            to="/admin/queues"
                                        />
                                    )}
                                    {data.queues.deferredEmails > 0 && (
                                        <QueueCard
                                            icon={Mail}
                                            count={data.queues.deferredEmails}
                                            title={m['admin.overview.queue.emails']()}
                                            detail={m['admin.overview.queue.emailsSub']()}
                                            tone="brand"
                                            to="/admin/email"
                                        />
                                    )}
                                    {(!ticketsEnabled || data.queues.tickets.pending === 0) &&
                                        (!billingEnabled || data.queues.billingExceptions === 0) &&
                                        data.workers.criticalWarnings === 0 &&
                                        data.queues.deferredEmails === 0 && (
                                            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-border-strong)] py-10 text-center">
                                                <CheckCircle2 className="h-5 w-5 text-[var(--color-accent)]" />
                                                <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.overview.queue.clear']()}</p>
                                            </div>
                                        )}
                                </div>
                            </div>

                            {/* Recent activity */}
                            <div className={panelClass()}>
                                <PanelHeader
                                    title={m['admin.overview.section.recentActivity']()}
                                    to="/admin/activity"
                                    action={m['admin.overview.link.viewAll']()}
                                />
                                {data.activity.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                                        <Activity className="h-5 w-5 text-[var(--color-ink-faint)]" />
                                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.overview.activity.empty']()}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col">
                                        {data.activity.map((a, i) => (
                                            <div
                                                key={a.id}
                                                className={cn(
                                                    'flex items-baseline gap-3 py-2.5 text-sm',
                                                    i > 0 && 'border-t border-[var(--color-border)]',
                                                )}
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="font-semibold text-[var(--color-ink)]">{a.actor}</span>{' '}
                                                    <span className="text-[var(--color-ink-muted)]">{a.description ?? a.event}</span>
                                                </span>
                                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                                    {timeAgo(a.timestamp)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </aside>
                    </div>
                </>
            )}
        </div>
    );
}

function pct(part: number, total: number): number {
    return total > 0 ? (part / total) * 100 : 0;
}
