import { m, td } from '@/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { formatMib } from '@/lib/format';
import { useBilling } from '@/state/billing';
import { SERVER_STATE } from '@/pages/admin/servers/serverState';
import { panelClass, PanelHeader } from '../../dashboardParts';
import { getAdminOrders, type AdminOrder, type OrderStatus } from '@/api/adminBillingOrders';
import { useServerView } from './ServerContext';

// Read-only landing tab: what this server *is* — identity facts, resource
// allotment, billing snapshot, and its slice of the order ledger — before any
// of the edit forms.

const microLabel = 'text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]';

// Days/hours until a renewal, flagged once it's in the past.
function timeUntil(iso: string): { days: number; hours: number; overdue: boolean } {
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    return {
        days: Math.floor(abs / 86_400_000),
        hours: Math.floor((abs / 3_600_000) % 24),
        overdue: diff < 0,
    };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <p className={cn(microLabel, 'mb-1')}>{label}</p>
            <div className="truncate text-sm text-[var(--color-ink)]">{children}</div>
        </div>
    );
}

function MetricRow({ label, value, first }: { label: string; value: React.ReactNode; first?: boolean }) {
    return (
        <div className={cn('flex items-baseline justify-between gap-3 py-1.5', !first && 'border-t border-[var(--color-border)]')}>
            <span className="text-xs text-[var(--color-ink-muted)]">{label}</span>
            <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">{value}</span>
        </div>
    );
}

export function OverviewTab({ onManageBilling }: { onManageBilling: () => void }) {
    const s = useServerView();
    const { money } = useBilling();
    const state = SERVER_STATE[s.state];
    const primary = s.allocations.find(a => a.id === s.allocationId) ?? null;
    const product = s.billing.product;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
                <section className={panelClass()}>
                    <PanelHeader title={m['admin.infrastructure.serverDetail.ov.configuration']()} />
                    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Fact label={m['admin.infrastructure.serverDetail.ov.state']()}>
                            <span className="inline-flex items-center gap-2">
                                <span className="h-2 w-2 rounded-sm" style={{ background: state.color }} />
                                {td(`admin.servers.state.${s.state}`, state.label)}
                            </span>
                        </Fact>
                        <Fact label={m['admin.infrastructure.serverDetail.net.node']()}>
                            <Link to={`/admin/infrastructure/nodes/${s.nodeId}`} className="text-[var(--brand-bright)] hover:underline">
                                {s.nodeName ?? `#${s.nodeId}`}
                            </Link>
                        </Fact>
                        <Fact label={m['admin.infrastructure.serverDetail.field.owner']()}>{s.ownerName ?? `#${s.ownerId}`}</Fact>
                        <Fact label={m['admin.infrastructure.serverDetail.field.egg']()}>{s.eggName ?? `#${s.eggId}`}</Fact>
                        <Fact label={m['admin.infrastructure.serverDetail.ov.primaryAllocation']()}>
                            {primary ? (
                                <span className="font-mono text-sm tabular-nums">
                                    {primary.ip}:{primary.port}
                                    {primary.alias ? ` (${primary.alias})` : ''}
                                </span>
                            ) : (
                                '—'
                            )}
                        </Fact>
                        <Fact label={m['admin.infrastructure.serverDetail.field.externalId']()}>
                            {s.externalId ? <span className="font-mono text-sm">{s.externalId}</span> : '—'}
                        </Fact>
                    </div>
                </section>

                <ServerOrders uuid={s.uuid} />
            </div>

            <aside className="flex flex-col gap-4">
                <section className={panelClass()}>
                    <PanelHeader title={m['admin.infrastructure.serverDetail.ov.resources']()} />
                    <MetricRow first label={m['admin.infrastructure.serverDetail.ov.memory']()} value={formatMib(s.limits.memory)} />
                    <MetricRow label={m['admin.infrastructure.serverDetail.ov.disk']()} value={formatMib(s.limits.disk)} />
                    <MetricRow
                        label={m['admin.infrastructure.serverDetail.ov.cpu']()}
                        value={s.limits.cpu === 0 ? '∞' : `${s.limits.cpu}%`}
                    />
                    <MetricRow
                        label={m['admin.infrastructure.serverDetail.ov.swap']()}
                        value={s.limits.swap === -1 ? '∞' : s.limits.swap === 0 ? '0' : formatMib(s.limits.swap)}
                    />
                    <MetricRow label={m['admin.infrastructure.serverDetail.ov.io']()} value={s.limits.io} />
                    <MetricRow
                        label={m['admin.infrastructure.serverDetail.ov.oom']()}
                        value={s.limits.oom_killer ? m['common.states.enabled']() : m['common.states.disabled']()}
                    />

                    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                        <p className={cn(microLabel, 'mb-1')}>{m['admin.infrastructure.serverDetail.nav.limits']()}</p>
                        <MetricRow first label={m['admin.infrastructure.serverDetail.field.allocations']()} value={s.featureLimits.allocations} />
                        <MetricRow label={m['admin.infrastructure.serverDetail.field.backups']()} value={s.featureLimits.backups} />
                        <MetricRow label={m['admin.infrastructure.serverDetail.field.databases']()} value={s.featureLimits.databases} />
                        <MetricRow label={m['admin.infrastructure.serverDetail.field.subusers']()} value={s.featureLimits.subusers} />
                        <MetricRow label={m['admin.infrastructure.serverDetail.field.subdomains']()} value={s.featureLimits.subdomains} />
                    </div>
                </section>

                <section className={panelClass()}>
                    <div className="mb-4 flex items-center gap-2">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                            {m['admin.infrastructure.serverDetail.nav.billing']()}
                        </h2>
                        <button
                            type="button"
                            onClick={onManageBilling}
                            className="ml-auto text-xs font-semibold text-[var(--brand-bright)] hover:underline"
                        >
                            {m['admin.infrastructure.serverDetail.ov.manage']()}
                        </button>
                    </div>
                    {!s.billing.productId ? (
                        <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.infrastructure.serverDetail.ov.notBillable']()}</p>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <p className="text-sm font-semibold text-[var(--color-ink)]">
                                {product?.name ?? m['admin.infrastructure.serverDetail.billing.planMissing']()}
                            </p>
                            {product && (
                                <p className="text-xs text-[var(--color-ink-muted)]">
                                    {m['admin.infrastructure.serverDetail.billing.summary.priceEvery']({
                                        price: money(product.price),
                                        count: s.billing.days ?? 30,
                                    })}
                                </p>
                            )}
                            {s.billing.renewalDate && <RenewalLine iso={s.billing.renewalDate} />}
                        </div>
                    )}
                </section>
            </aside>
        </div>
    );
}

function RenewalLine({ iso }: { iso: string }) {
    const { days, hours, overdue } = timeUntil(iso);
    return (
        <p className="mt-2 flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-2 text-xs">
            <span className="text-[var(--color-ink-muted)]">{m['admin.infrastructure.serverDetail.billing.summary.renewal']()}</span>
            <span className="text-right">
                <span className="font-mono tabular-nums text-[var(--color-ink)]">{new Date(iso).toLocaleDateString()}</span>
                <span className={cn('ml-2 font-mono tabular-nums', overdue ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]')}>
                    {overdue
                        ? m['admin.infrastructure.serverDetail.billing.summary.overdue']({ days, hours })
                        : m['admin.infrastructure.serverDetail.billing.summary.remaining']({ days, hours })}
                </span>
            </span>
        </p>
    );
}

// The server's slice of the order ledger. Renewal orders embed the short uuid in
// their name, which is the only link the orders filter exposes — same lookup V1's
// OrdersTable used here.
function ServerOrders({ uuid }: { uuid: string }) {
    const shortUuid = uuid.slice(0, 8);
    const { money } = useBilling();

    const ordersQ = useQuery({
        queryKey: ['admin', 'server-orders', shortUuid],
        queryFn: () => getAdminOrders(1, { name: shortUuid }, 'created_at', true, 10),
    });

    return (
        <section className={panelClass()}>
            <PanelHeader
                title={m['admin.infrastructure.serverDetail.billing.orders.title']()}
                to="/admin/billing/orders"
                action={m['admin.overview.link.viewAll']()}
            />

            {ordersQ.isLoading ? (
                <div className="flex justify-center py-8">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : ordersQ.isError ? (
                <p className="py-4 text-sm text-[var(--color-danger)]">
                    {m['admin.infrastructure.serverDetail.billing.orders.loadError']()}
                </p>
            ) : !ordersQ.data?.items.length ? (
                <p className="py-4 text-sm text-[var(--color-ink-faint)]">
                    {m['admin.infrastructure.serverDetail.billing.orders.empty']()}
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className={cn('text-left', microLabel)}>
                                <th className="py-2 pr-4 font-semibold">{m['admin.infrastructure.serverDetail.billing.orders.id']()}</th>
                                <th className="py-2 pr-4 font-semibold">{m['admin.infrastructure.serverDetail.billing.orders.name']()}</th>
                                <th className="py-2 pr-4 font-semibold">{m['admin.infrastructure.serverDetail.billing.orders.status']()}</th>
                                <th className="py-2 pr-4 text-right font-semibold">{m['admin.infrastructure.serverDetail.billing.orders.total']()}</th>
                                <th className="py-2 text-right font-semibold">{m['admin.infrastructure.serverDetail.billing.orders.date']()}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ordersQ.data.items.map(order => (
                                <OrderRow key={order.id} order={order} money={money} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

const STATUS_TONE: Record<OrderStatus, string> = {
    processed: 'text-[var(--color-accent)]',
    pending: 'text-[var(--color-warning)]',
    failed: 'text-[var(--color-danger)]',
    cancelled: 'text-[var(--color-ink-faint)]',
    expired: 'text-[var(--color-ink-faint)]',
};

function OrderRow({ order, money }: { order: AdminOrder; money: (n: number) => string }) {
    return (
        <tr className="border-t border-[var(--color-border)]">
            <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">#{order.id}</td>
            <td className="py-2.5 pr-4 text-[var(--color-ink)]">{order.name}</td>
            <td className={cn('py-2.5 pr-4 text-xs font-medium', STATUS_TONE[order.status])}>
                {td(`billing.orders.status.${order.status}`, order.status)}
            </td>
            <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-[var(--color-ink)]">{money(order.total)}</td>
            <td className="py-2.5 text-right font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                {new Date(order.createdAt).toLocaleDateString()}
            </td>
        </tr>
    );
}
