import { m } from '@/i18n';
import { useQuery } from '@tanstack/react-query';
import {
    TrendingUp,
    CalendarClock,
    PauseCircle,
    Receipt,
    Boxes,
    BarChart3,
    PieChart,
    type LucideIcon,
} from 'lucide-react';
import { getBillingAnalytics } from '@/api/billing';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency, timeAgo } from '@/lib/format';
import { RevenueBars, StatusDonut, RenewalBars, statusColor } from './charts';

// KPI card with a coloured icon chip so the dashboard reads at a glance.
function Kpi({
    icon: Icon,
    label,
    value,
    sub,
    tone,
}: {
    icon: LucideIcon;
    label: string;
    value: string;
    sub?: string;
    tone: string;
}) {
    return (
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3.5">
            <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}
            >
                <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{label}</p>
                <p className="font-mono text-xl leading-none tabular-nums text-[var(--color-ink)]">{value}</p>
                {sub && <p className="mt-1 text-[11px] tabular-nums text-[var(--color-ink-faint)]">{sub}</p>}
            </div>
        </div>
    );
}

export default function BillingOverviewPage() {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'analytics'],
        queryFn: getBillingAnalytics,
    });

    if (isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    if (isError || !data) {
        return <p className="text-sm text-[var(--color-danger)]">{m['admin.billing.common.loadError']()}</p>;
    }

    const r = data.upcomingRenewals;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.overview.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.overview.subtitle']()}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    icon={TrendingUp}
                    tone="var(--color-accent)"
                    label={m['admin.billing.overview.forecast7']()}
                    value={formatCurrency(data.forecast.next7Days)}
                    sub={m['admin.billing.overview.forecast30']({ amount: formatCurrency(data.forecast.next30Days) })}
                />
                <Kpi
                    icon={CalendarClock}
                    tone="var(--color-warning)"
                    label={m['admin.billing.overview.renewals14']()}
                    value={String(r.total14Days.count)}
                    sub={formatCurrency(r.total14Days.expectedRevenue)}
                />
                <Kpi
                    icon={Boxes}
                    tone="var(--brand)"
                    label={m['admin.billing.overview.catalog']()}
                    value={String(data.productCount)}
                    sub={m['admin.billing.overview.categoriesCount']({ count: data.categoryCount })}
                />
                <Kpi
                    icon={PauseCircle}
                    tone="var(--color-danger)"
                    label={m['admin.billing.overview.suspended']()}
                    value={String(data.suspendedServers.length)}
                    sub={m['admin.billing.overview.ordersYear']({ count: data.orderCount })}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Panel title={m['admin.billing.overview.revenueTrend']()} icon={BarChart3} className="lg:col-span-2" bodyClassName="p-4">
                    <RevenueBars points={data.monthlyRevenue} />
                </Panel>
                <Panel title={m['admin.billing.overview.orderStatus']()} icon={PieChart} bodyClassName="p-4">
                    <StatusDonut slices={data.statusBreakdown} />
                </Panel>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title={m['admin.billing.overview.upcomingRenewals']()} icon={CalendarClock} bodyClassName="p-4">
                    <RenewalBars
                        rows={[
                            { label: m['admin.billing.overview.overdue'](), window: r.overdue, color: 'var(--color-danger)' },
                            { label: m['admin.billing.overview.due7'](), window: r.in7Days, color: 'var(--color-warning)' },
                            { label: m['admin.billing.overview.due8to14'](), window: r.in8to14Days, color: 'var(--color-accent)' },
                        ]}
                    />
                </Panel>

                <Panel title={m['admin.billing.overview.recentEvents']()} icon={Receipt} bodyClassName="p-4">
                    {data.recentEvents.length === 0 ? (
                        <p className="py-2 text-sm text-[var(--color-ink-faint)]">{m['admin.billing.overview.noEvents']()}</p>
                    ) : (
                        <ul className="flex flex-col">
                            {data.recentEvents.map(e => (
                                <li
                                    key={e.id}
                                    className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 last:border-0"
                                >
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ background: statusColor(e.status) }}
                                        />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm text-[var(--color-ink)]">
                                                {e.serverName ?? m['admin.billing.overview.eventTypeOrder']({ type: e.type })}
                                            </span>
                                            <span className="text-xs text-[var(--color-ink-faint)]">
                                                {e.status} · {timeAgo(e.date)}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">
                                        {formatCurrency(e.total)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            {data.suspendedServers.length > 0 && (
                <Panel title={m['admin.billing.overview.suspendedServers']()} icon={PauseCircle} bodyClassName="p-4">
                    <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                        {data.suspendedServers.map(s => (
                            <li
                                key={s.id}
                                className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-sm text-[var(--color-ink)]">{s.name}</span>
                                    <span className="text-xs text-[var(--color-ink-faint)]">
                                        {s.owner}
                                        {s.ownerEmail ? ` · ${s.ownerEmail}` : ''}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}
        </div>
    );
}
