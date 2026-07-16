import { m } from '@/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
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
} from 'lucide-react';
import { getAdminOverview, type AdminOverview } from '@/api/adminOverview';
import { useFlags } from '@/state/flags';
import { Spinner } from '@/components/ui/Spinner';
import { formatMib, formatCurrency, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

type Tone = 'brand' | 'accent' | 'warning' | 'danger';

const toneText: Record<Tone, string> = {
    brand: 'text-[var(--brand)]',
    accent: 'text-[var(--color-accent)]',
    warning: 'text-[var(--color-warning)]',
    danger: 'text-[var(--color-danger)]',
};
const toneBar: Record<Tone, string> = {
    brand: 'bg-[var(--brand)]',
    accent: 'bg-[var(--color-accent)]',
    warning: 'bg-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger)]',
};

function KpiTile({
    icon: Icon,
    label,
    value,
    sub,
    tone = 'brand',
    to,
}: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    sub?: React.ReactNode;
    tone?: Tone;
    to?: string;
}) {
    const body = (
        <>
            <div
                className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)]',
                    tone === 'warning' && 'bg-[var(--color-warning)]/10',
                    tone === 'accent' && 'bg-[var(--color-accent)]/10',
                )}
            >
                <Icon className={cn('h-5 w-5', tone === 'brand' ? 'text-[var(--brand)]' : toneText[tone])} />
            </div>
            <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</p>
                <p className="text-xl font-semibold tabular-nums text-[var(--color-ink)]">{value}</p>
                {sub && <p className="text-xs text-[var(--color-ink-muted)]">{sub}</p>}
            </div>
        </>
    );
    const className =
        'flex items-center gap-4 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-5';
    return to ? (
        <Link to={to} className={cn(className, 'transition-colors hover:bg-[var(--color-surface-2)]')}>
            {body}
        </Link>
    ) : (
        <div className={className}>{body}</div>
    );
}

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
            className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)]"
        >
            <span className={cn('absolute inset-y-0 left-0 w-[3px]', toneBar[tone])} />
            <Icon className={cn('h-4 w-4 shrink-0', toneText[tone])} />
            <span className={cn('text-2xl font-semibold tabular-nums', toneText[tone])}>{count}</span>
            <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-ink)]">{title}</span>
                <span className="block truncate text-xs text-[var(--color-ink-muted)]">{detail}</span>
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
        </Link>
    );
}

function CapacityBar({ label, percent }: { label: string; percent: number }) {
    const over = percent > 100;
    const tone: Tone = percent >= 100 ? 'danger' : percent >= 85 ? 'warning' : 'brand';
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-[var(--color-ink)]">{label}</span>
                <span className={cn('text-xs tabular-nums', over ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]')}>
                    {percent}%
                </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className={cn('h-full rounded-full', toneBar[tone])} style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
        </div>
    );
}

function PanelHeader({ title, to, action }: { title: string; to?: string; action?: string }) {
    return (
        <div className="mb-4 flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{title}</h2>
            {to && action && (
                <Link to={to} className="ml-auto text-xs font-semibold text-[var(--brand)] hover:underline">
                    {action}
                </Link>
            )}
        </div>
    );
}

function panelClass(extra?: string) {
    return cn(
        'rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5',
        extra,
    );
}

interface AttentionItem {
    key: string;
    label: string;
    to?: string;
}

function buildAttention(data: AdminOverview, billingEnabled: boolean, ticketsEnabled: boolean): AttentionItem[] {
    const items: AttentionItem[] = [];
    if (!data.health.version.isLatest) {
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
    return items;
}

function HealthBanner({ items, version }: { items: AttentionItem[]; version: string }) {
    if (items.length === 0) {
        return (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                <span className="text-[var(--color-ink)]">{m['admin.overview.nominal']({ version })}</span>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--color-warning)]/45 bg-[var(--color-warning)]/10 px-4 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
            <span className="font-semibold text-[var(--color-ink)]">{m['admin.overview.attention.label']()}</span>
            <span className="text-[var(--color-ink-muted)]">
                {items.map(i => i.label).join('  ·  ')}
            </span>
            <span className="ml-auto flex flex-wrap gap-1.5">
                {items.map(i =>
                    i.to ? (
                        <Link
                            key={i.key}
                            to={i.to}
                            className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-warning)] hover:text-[var(--color-warning)]"
                        >
                            {i.label}
                        </Link>
                    ) : null,
                )}
            </span>
        </div>
    );
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
                <div className="rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                    {error instanceof Error ? error.message : m['common.states.genericError']()}
                </div>
            )}

            {data && (
                <>
                    <HealthBanner
                        items={buildAttention(data, billingEnabled, ticketsEnabled)}
                        version={data.health.version.current}
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
                            tone={data.fleet.nodes.maintenance > 0 ? 'warning' : 'brand'}
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
                            to="/admin/users"
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
                                tone={data.queues.tickets.pending > 0 ? 'warning' : 'brand'}
                                to={ticketsEnabled ? '/admin/tickets' : undefined}
                            />
                        )}
                    </div>

                    {/* Three columns */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        {/* Fleet health */}
                        <div className={panelClass()}>
                            <PanelHeader
                                title={m['admin.overview.section.fleetHealth']()}
                                to="/admin/infrastructure"
                                action={m['admin.overview.link.infrastructure']()}
                            />
                            <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
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
                                <CapacityBar label={m['admin.overview.fleet.memory']()} percent={data.fleet.capacity.memoryPercent} />
                                <CapacityBar label={m['admin.overview.fleet.disk']()} percent={data.fleet.capacity.diskPercent} />
                            </div>
                            <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                                {m['admin.overview.fleet.allocated']({
                                    memory: formatMib(data.fleet.capacity.memoryUsed),
                                    total: formatMib(data.fleet.capacity.memoryTotal),
                                })}
                            </p>
                        </div>

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
                                    data.queues.deferredEmails === 0 && (
                                        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border-strong)] py-10 text-center">
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
                                                'flex items-center gap-3 py-2.5 text-sm',
                                                i > 0 && 'border-t border-[var(--color-border)]',
                                            )}
                                        >
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[11px] font-semibold uppercase text-[var(--color-ink-muted)]">
                                                {a.actor.slice(0, 2)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="font-semibold text-[var(--color-ink)]">{a.actor}</span>{' '}
                                                <span className="text-[var(--color-ink-muted)]">{a.description ?? a.event}</span>
                                            </span>
                                            <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">{timeAgo(a.timestamp)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* System strip */}
                    <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-4">
                        <SysStat
                            label={m['admin.overview.system.version']()}
                            value={data.health.version.current}
                            hint={
                                data.health.version.isLatest
                                    ? m['admin.overview.system.upToDate']()
                                    : m['admin.overview.system.updateAvailable']({ version: data.health.version.latest })
                            }
                            hintTone={data.health.version.isLatest ? 'accent' : 'warning'}
                        />
                        <SysStat
                            label={m['admin.overview.system.nodes']()}
                            value={m['admin.overview.system.nodesValue']({
                                total: data.fleet.nodes.total,
                                maintenance: data.fleet.nodes.maintenance,
                            })}
                        />
                        <SysStat label={m['admin.overview.system.emails']()} value={String(data.queues.deferredEmails)} />
                        <SysStat label={m['admin.overview.system.servers']()} value={String(data.fleet.servers.total)} />
                    </div>
                </>
            )}
        </div>
    );
}

function pct(part: number, total: number): number {
    return total > 0 ? (part / total) * 100 : 0;
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
            {label}
        </span>
    );
}

function SysStat({
    label,
    value,
    hint,
    hintTone = 'accent',
}: {
    label: string;
    value: string;
    hint?: string;
    hintTone?: 'accent' | 'warning';
}) {
    return (
        <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</p>
            <p className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">
                {value}
                {hint && (
                    <span className={cn('ml-1.5 font-medium', hintTone === 'accent' ? 'text-[var(--color-accent)]' : 'text-[var(--color-warning)]')}>
                        · {hint}
                    </span>
                )}
            </p>
        </div>
    );
}
