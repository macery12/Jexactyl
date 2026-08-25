import { m, td } from '@/i18n/messages';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Repeat, CalendarClock, Boxes } from 'lucide-react';
import { getBillingAnalytics, type BillingAnalytics } from '@/api/billing';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { panelClass, PanelHeader, KpiTile, StatusLine, type AttentionItem } from '../dashboardParts';
import { RevenueBars, CompositionBar, RenewalBars, statusColor, processorColor } from './charts';

const microLabel = 'text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]';

function buildAttention(data: BillingAnalytics): AttentionItem[] {
    const items: AttentionItem[] = [];
    const overdue = data.upcomingRenewals.overdue;
    if (overdue.count > 0) {
        items.push({
            key: 'overdue',
            label: m['admin.billing.overview.attention.overdue']({
                count: overdue.count,
                amount: formatCurrency(overdue.expectedRevenue),
            }),
        });
    }
    if (data.exceptions7d > 0) {
        items.push({
            key: 'exceptions',
            label: m['admin.billing.overview.attention.exceptions']({ count: data.exceptions7d }),
            to: '/admin/billing/exceptions',
        });
    }
    if (data.suspendedServers.length > 0) {
        items.push({
            key: 'suspended',
            label: m['admin.billing.overview.attention.suspended']({ count: data.suspendedServers.length }),
        });
    }
    return items;
}

// What's selling: per-product subscription count + MRR contribution, with a
// proportional bar so the spread reads at a glance.
function TopProducts({ products }: { products: BillingAnalytics['topProducts'] }) {
    const maxMrr = Math.max(...products.map(p => p.mrr), 1);

    if (products.length === 0) {
        return <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.billing.overview.noTopProducts']()}</p>;
    }

    return (
        <div className="flex flex-col">
            {products.map((p, i) => (
                <div key={p.id} className={cn('flex flex-col gap-1.5 py-2.5', i > 0 && 'border-t border-[var(--color-border)]')}>
                    <div className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-ink)]">{p.name}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                            {m['admin.billing.overview.subsCount']({ count: p.subscriptions })}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--color-ink)]">
                            {m['admin.billing.overview.perMonth']({ amount: formatCurrency(p.mrr) })}
                        </span>
                    </div>
                    <div className="h-1.5 rounded-sm bg-[var(--color-surface-2)]">
                        <div className="h-full rounded-sm bg-[var(--brand)]" style={{ width: `${(p.mrr / maxMrr) * 100}%` }} />
                    </div>
                </div>
            ))}
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
    const suspended = data.suspendedServers;
    const shownSuspended = suspended.slice(0, 6);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.overview.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.overview.subtitle']()}</p>
            </div>

            <StatusLine
                items={buildAttention(data)}
                info={m['admin.billing.overview.mrrLine']({ amount: formatCurrency(data.forecast.next30Days) })}
            />

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <KpiTile
                    icon={TrendingUp}
                    label={m['admin.billing.overview.kpi.mrr']()}
                    value={formatCurrency(data.forecast.next30Days)}
                    sub={m['admin.billing.overview.kpi.next7']({ amount: formatCurrency(data.forecast.next7Days) })}
                    tone="accent"
                />
                <KpiTile
                    icon={Repeat}
                    label={m['admin.billing.overview.kpi.subscriptions']()}
                    value={String(data.activeSubscriptions)}
                    sub={
                        suspended.length > 0 ? (
                            <span className="text-[var(--color-warning)]">
                                {m['admin.billing.overview.kpi.suspended']({ count: suspended.length })}
                            </span>
                        ) : undefined
                    }
                />
                <KpiTile
                    icon={CalendarClock}
                    label={m['admin.billing.overview.renewals14']()}
                    value={String(r.total14Days.count)}
                    sub={formatCurrency(r.total14Days.expectedRevenue)}
                    tone={r.overdue.count > 0 ? 'warning' : undefined}
                />
                <KpiTile
                    icon={Boxes}
                    label={m['admin.billing.overview.catalog']()}
                    value={String(data.productCount)}
                    sub={m['admin.billing.overview.categoriesCount']({ count: data.categoryCount })}
                    to="/admin/billing/products"
                />
            </div>

            {/* Revenue board + right rail */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="flex flex-col gap-4 lg:col-span-2">
                    <section className={panelClass()}>
                        <PanelHeader title={m['admin.billing.overview.revenueTrend']()} />
                        <RevenueBars points={data.monthlyRevenue} />

                        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
                            <div className="mb-2.5 flex items-baseline justify-between gap-2">
                                <p className={microLabel}>{m['admin.billing.overview.orderStatus']()}</p>
                                <span className="font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                                    {m['admin.billing.overview.ordersYear']({ count: data.orderCount })}
                                </span>
                            </div>
                            <CompositionBar
                                emptyLabel={m['admin.billing.overview.noOrders']()}
                                slices={data.statusBreakdown.map(s => ({
                                    key: s.status,
                                    label: td(`admin.billing.overview.status.${s.status}`, s.status),
                                    color: statusColor(s.status),
                                    count: s.count,
                                }))}
                            />
                        </div>

                        {data.processorBreakdown.length > 0 && (
                            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                                <p className={cn(microLabel, 'mb-2.5')}>{m['admin.billing.overview.processedVia']()}</p>
                                <CompositionBar
                                    emptyLabel={m['admin.billing.overview.noOrders']()}
                                    slices={data.processorBreakdown.map(p => ({
                                        key: p.processor,
                                        label: td(`admin.billing.overview.processor.${p.processor}`, p.processor),
                                        color: processorColor(p.processor),
                                        count: p.count,
                                    }))}
                                />
                            </div>
                        )}
                    </section>

                    <section className={panelClass()}>
                        <PanelHeader
                            title={m['admin.billing.overview.topProducts']()}
                            to="/admin/billing/products"
                            action={m['admin.overview.link.viewAll']()}
                        />
                        <TopProducts products={data.topProducts} />
                    </section>
                </div>

                <aside className="flex flex-col gap-4">
                    <div className={panelClass()}>
                        <PanelHeader title={m['admin.billing.overview.upcomingRenewals']()} />
                        <RenewalBars
                            rows={[
                                { label: m['admin.billing.overview.overdue'](), window: r.overdue, color: 'var(--color-danger)' },
                                { label: m['admin.billing.overview.due7'](), window: r.in7Days, color: 'var(--color-warning)' },
                                { label: m['admin.billing.overview.due8to14'](), window: r.in8to14Days, color: 'var(--color-accent)' },
                            ]}
                        />
                    </div>

                    {suspended.length > 0 && (
                        <div className={panelClass()}>
                            <div className="mb-4 flex items-center gap-2">
                                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                                    {m['admin.billing.overview.suspendedServers']()}
                                </h2>
                                <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-[var(--color-warning)]">
                                    {suspended.length}
                                </span>
                            </div>
                            <div className="flex flex-col">
                                {shownSuspended.map((s, i) => (
                                    <div key={s.id} className={cn('py-2', i > 0 && 'border-t border-[var(--color-border)]')}>
                                        <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{s.name}</span>
                                        <span className="block truncate text-xs text-[var(--color-ink-faint)]">
                                            {s.owner}
                                            {s.ownerEmail ? ` · ${s.ownerEmail}` : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            {suspended.length > shownSuspended.length && (
                                <p className="mt-2 font-mono text-xs text-[var(--color-ink-faint)]">
                                    {m['admin.billing.overview.suspendedMore']({ count: suspended.length - shownSuspended.length })}
                                </p>
                            )}
                        </div>
                    )}

                    <div className={panelClass()}>
                        <PanelHeader
                            title={m['admin.billing.overview.recentEvents']()}
                            to="/admin/billing/orders"
                            action={m['admin.overview.link.viewAll']()}
                        />
                        {data.recentEvents.length === 0 ? (
                            <p className="py-2 text-sm text-[var(--color-ink-faint)]">{m['admin.billing.overview.noEvents']()}</p>
                        ) : (
                            <div className="flex flex-col">
                                {data.recentEvents.map((e, i) => (
                                    <div
                                        key={e.id}
                                        className={cn(
                                            'flex items-center justify-between gap-3 py-2.5',
                                            i > 0 && 'border-t border-[var(--color-border)]',
                                        )}
                                    >
                                        <span className="flex min-w-0 items-center gap-2.5">
                                            <span
                                                className="h-2 w-2 shrink-0 rounded-sm"
                                                style={{ background: statusColor(e.status) }}
                                            />
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">
                                                    {e.serverName ?? m['admin.billing.overview.eventTypeOrder']({ type: e.type })}
                                                </span>
                                                <span className="block font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                                    {td(`admin.billing.overview.status.${e.status}`, e.status)} · {timeAgo(e.date)}
                                                </span>
                                            </span>
                                        </span>
                                        <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--color-ink)]">
                                            {formatCurrency(e.total)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}
