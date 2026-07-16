import { m, td } from '@/i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useBilling } from '@/state/billing';
import { getAdminOrders, type AdminOrder, type OrderStatus } from '@/api/adminBillingOrders';
import { useServerView } from './ServerContext';
import { EditBillingModal } from './EditBillingModal';

// Days/hours until a renewal, or nulls once it's in the past.
function timeUntil(iso: string): { days: number; hours: number; overdue: boolean } {
    const diff = new Date(iso).getTime() - Date.now();
    const overdue = diff < 0;
    const abs = Math.abs(diff);
    return {
        days: Math.floor(abs / 86_400_000),
        hours: Math.floor((abs / 3_600_000) % 24),
        overdue,
    };
}

export function BillingSection({ readOnly }: { readOnly: boolean }) {
    const s = useServerView();
    const { billing: config, money } = useBilling();
    const [editing, setEditing] = useState(false);

    const product = s.billing.product;
    const days = s.billing.days;

    return (
        <div className="flex flex-col gap-5">
            {!config.enabled && (
                <div className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-warning)]">
                    {m['admin.infrastructure.serverDetail.billing.moduleDisabled']()}
                </div>
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="grid flex-1 gap-3 sm:grid-cols-3">
                        <Summary label={m['admin.infrastructure.serverDetail.billing.summary.plan']()}>
                            {!s.billing.productId ? (
                                <Muted>{m['admin.infrastructure.serverDetail.billing.none']()}</Muted>
                            ) : !product ? (
                                <Muted>{m['admin.infrastructure.serverDetail.billing.planMissing']()}</Muted>
                            ) : (
                                <>
                                    <span className="font-medium text-[var(--color-ink)]">{product.name}</span>
                                    <span className="block text-xs text-[var(--color-ink-faint)]">
                                        {m['admin.infrastructure.serverDetail.billing.summary.priceEvery']({
                                            price: money(product.price),
                                            count: days ?? 30,
                                        })}
                                    </span>
                                </>
                            )}
                        </Summary>

                        <Summary label={m['admin.infrastructure.serverDetail.billing.summary.renewal']()}>
                            {!s.billing.renewalDate ? (
                                <Muted>{m['admin.infrastructure.serverDetail.billing.none']()}</Muted>
                            ) : (
                                <Renewal iso={s.billing.renewalDate} />
                            )}
                        </Summary>

                        <Summary label={m['admin.infrastructure.serverDetail.billing.summary.limits']()}>
                            {!product ? (
                                <Muted>{m['admin.infrastructure.serverDetail.billing.none']()}</Muted>
                            ) : (
                                <span className="text-[var(--color-ink)]">
                                    {m['admin.infrastructure.serverDetail.billing.summary.limitsValue']({
                                        cpu: product.limits.cpu,
                                        memory: (product.limits.memory / 1024).toFixed(1),
                                        disk: (product.limits.disk / 1024).toFixed(1),
                                    })}
                                </span>
                            )}
                        </Summary>
                    </div>

                    {!readOnly && (
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                            <Pencil className="h-3.5 w-3.5" />
                            {m['common.actions.edit']()}
                        </Button>
                    )}
                </div>
            </div>

            <ServerOrders uuid={s.uuid} />

            {!readOnly && <EditBillingModal open={editing} onClose={() => setEditing(false)} server={s} />}
        </div>
    );
}

function Renewal({ iso }: { iso: string }) {
    const { days, hours, overdue } = timeUntil(iso);
    return (
        <>
            <span className="font-medium text-[var(--color-ink)]">{new Date(iso).toLocaleDateString()}</span>
            <span className={cn('block text-xs', overdue ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]')}>
                {overdue
                    ? m['admin.infrastructure.serverDetail.billing.summary.overdue']({ days, hours })
                    : m['admin.infrastructure.serverDetail.billing.summary.remaining']({ days, hours })}
            </span>
        </>
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
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                    {m['admin.infrastructure.serverDetail.billing.orders.title']()}
                </h3>
            </div>

            {ordersQ.isLoading ? (
                <div className="flex justify-center py-8">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : ordersQ.isError ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--color-danger)]">
                    {m['admin.infrastructure.serverDetail.billing.orders.loadError']()}
                </p>
            ) : !ordersQ.data?.items.length ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">
                    {m['admin.infrastructure.serverDetail.billing.orders.empty']()}
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-[var(--color-ink-faint)]">
                                <th className="px-4 py-2 font-medium">{m['admin.infrastructure.serverDetail.billing.orders.id']()}</th>
                                <th className="px-4 py-2 font-medium">{m['admin.infrastructure.serverDetail.billing.orders.name']()}</th>
                                <th className="px-4 py-2 font-medium">{m['admin.infrastructure.serverDetail.billing.orders.status']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.infrastructure.serverDetail.billing.orders.total']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.infrastructure.serverDetail.billing.orders.date']()}</th>
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
        </div>
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
            <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-ink-faint)]">#{order.id}</td>
            <td className="px-4 py-2.5 text-[var(--color-ink)]">{order.name}</td>
            <td className={cn('px-4 py-2.5 text-xs font-medium', STATUS_TONE[order.status])}>
                {td(`billing.orders.status.${order.status}`, order.status)}
            </td>
            <td className="px-4 py-2.5 text-right text-[var(--color-ink)]">{money(order.total)}</td>
            <td className="px-4 py-2.5 text-right text-xs text-[var(--color-ink-faint)]">
                {new Date(order.createdAt).toLocaleDateString()}
            </td>
        </tr>
    );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{label}</p>
            <div className="text-sm">{children}</div>
        </div>
    );
}

function Muted({ children }: { children: React.ReactNode }) {
    return <span className="text-[var(--color-ink-faint)]">{children}</span>;
}
