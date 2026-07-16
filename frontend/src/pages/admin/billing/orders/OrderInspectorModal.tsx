import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useBilling } from '@/state/billing';
import { getOrderThreat, type AdminOrder } from '@/api/adminBillingOrders';
import { StatusPill, ProcessorBadge, orderTypeLabel } from '../shared';

type DetailTab = 'overview' | 'customer' | 'payment' | 'threat';

function fmtDate(input: string | null): string {
    if (!input) return '—';
    return new Date(input).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-2 py-2">
            <span className="text-sm text-[var(--color-ink-muted)]">{label}</span>
            <span className="text-right text-sm text-[var(--color-ink)]">{children}</span>
        </div>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
            <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-1">
                {children}
            </div>
        </div>
    );
}

function mono(v: string) {
    return <code className="font-mono text-xs text-[var(--color-ink)]">{v}</code>;
}

function OverviewTab({ order }: { order: AdminOrder }) {
    const { money } = useBilling();
    return (
        <div className="flex flex-col gap-5">
            <Card title={m['admin.billing.orders.detail.orderInfo']()}>
                <Row label={m['billing.orders.col.id']()}>{mono(`#${order.id}`)}</Row>
                <Row label={m['billing.orders.detail.name']()}>{order.name || '—'}</Row>
                <Row label={m['billing.orders.col.type']()}>{orderTypeLabel(order.type)}</Row>
                <Row label={m['billing.orders.col.status']()}>
                    <StatusPill status={order.status} />
                </Row>
                <Row label={m['billing.orders.detail.created']()}>{fmtDate(order.createdAt)}</Row>
                {order.updatedAt && <Row label={m['billing.orders.detail.updated']()}>{fmtDate(order.updatedAt)}</Row>}
            </Card>

            <Card title={m['billing.orders.detail.productBilling']()}>
                <Row label={m['billing.orders.detail.product']()}>{order.productName ?? `#${order.productId}`}</Row>
                {order.serverName && <Row label={m['billing.orders.col.server']()}>{order.serverName}</Row>}
                {order.billingDays != null && (
                    <Row label={m['billing.orders.col.period']()}>
                        {m['billing.orders.detail.days']({ count: order.billingDays })}
                    </Row>
                )}
                {order.subtotal != null && <Row label={m['billing.orders.detail.subtotal']()}>{money(order.subtotal)}</Row>}
                {order.discount != null && order.discount > 0 && (
                    <Row label={m['billing.orders.detail.discount']()}>−{money(order.discount)}</Row>
                )}
                <Row label={m['billing.orders.detail.total']()}>
                    <span className="font-semibold">{money(order.total)}</span>
                </Row>
            </Card>
        </div>
    );
}

function CustomerTab({ order }: { order: AdminOrder }) {
    return (
        <Card title={m['admin.billing.orders.detail.customer']()}>
            <Row label={m['admin.billing.orders.col.customer']()}>
                {order.username ?? m['admin.billing.orders.userN']({ id: order.userId ?? 0 })}
            </Row>
            {order.userEmail && <Row label={m['admin.billing.orders.detail.email']()}>{order.userEmail}</Row>}
            {order.userId != null && <Row label={m['admin.billing.orders.detail.userId']()}>{mono(`#${order.userId}`)}</Row>}
        </Card>
    );
}

function dashboardUrl(order: AdminOrder): string | null {
    const ext = order.transaction?.externalId;
    if (!ext) return null;
    if (order.paymentProcessor === 'stripe') return `https://dashboard.stripe.com/payments/${ext}`;
    if (order.paymentProcessor === 'paypal') return `https://www.paypal.com/activity/payment/${ext}`;
    return null;
}

function PaymentTab({ order }: { order: AdminOrder }) {
    const { money } = useBilling();
    const tx = order.transaction;
    const url = dashboardUrl(order);
    return (
        <div className="flex flex-col gap-5">
            <Card title={m['billing.orders.detail.provider']()}>
                <Row label={m['billing.orders.detail.provider']()}>
                    <ProcessorBadge processor={order.paymentProcessor} />
                </Row>
                {url && (
                    <Row label={m['billing.orders.detail.dashboard']()}>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-[var(--brand)] hover:underline"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {m['billing.orders.detail.viewInDashboard']()}
                        </a>
                    </Row>
                )}
            </Card>

            <Card title={m['billing.orders.detail.transaction']()}>
                {order.paymentProcessor === 'free' ? (
                    <Row label={m['billing.orders.detail.payment']()}>{m['billing.orders.detail.noPayment']()}</Row>
                ) : tx ? (
                    <>
                        {tx.externalId && <Row label={m['billing.orders.detail.reference']()}>{mono(tx.externalId)}</Row>}
                        {tx.captureId && <Row label={m['billing.orders.detail.captureId']()}>{mono(tx.captureId)}</Row>}
                        {tx.amount != null && <Row label={m['billing.orders.detail.amount']()}>{money(tx.amount)}</Row>}
                        {tx.status && (
                            <Row label={m['billing.orders.col.status']()}>
                                <span className="capitalize">{tx.status}</span>
                            </Row>
                        )}
                        {tx.payerId && <Row label={m['admin.billing.orders.detail.payerId']()}>{mono(tx.payerId)}</Row>}
                        {tx.payerEmail && <Row label={m['billing.orders.detail.payer']()}>{tx.payerEmail}</Row>}
                        {tx.capturedAt && <Row label={m['billing.orders.detail.capturedAt']()}>{fmtDate(tx.capturedAt)}</Row>}
                    </>
                ) : (
                    <Row label={m['billing.orders.detail.payment']()}>{m['billing.orders.detail.noTransaction']()}</Row>
                )}
            </Card>
        </div>
    );
}

function threatTone(score: number): string {
    if (score >= 50) return 'text-[var(--color-danger)]';
    if (score >= 25) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-accent)]';
}

function ThreatTab({ order }: { order: AdminOrder }) {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'order-threat', order.id],
        queryFn: () => getOrderThreat(order.id),
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-10">
                <Spinner className="h-5 w-5" />
            </div>
        );
    }
    if (isError || !data) {
        return <p className="py-6 text-center text-sm text-[var(--color-danger)]">{m['common.states.genericError']()}</p>;
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3">
                <ShieldAlert className={cn('h-6 w-6', threatTone(data.score))} />
                <div>
                    <p className={cn('text-2xl font-semibold leading-none', threatTone(data.score))}>{data.score}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{m['admin.billing.orders.threat.scoreLabel']()}</p>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                {data.signals.map(s => (
                    <div
                        key={s.category}
                        className={cn(
                            'flex items-start justify-between gap-3 rounded-lg border px-3 py-2',
                            s.fired
                                ? 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5'
                                : 'border-[var(--color-border)] bg-[var(--color-surface-2)]/30',
                        )}
                    >
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--color-ink)]">{s.category}</p>
                            <p className="text-xs text-[var(--color-ink-muted)]">{s.description}</p>
                        </div>
                        <span
                            className={cn(
                                'shrink-0 text-xs font-semibold',
                                s.fired ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]',
                            )}
                        >
                            {s.points}/{s.maxPoints}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function OrderInspectorModal({ order, onClose }: { order: AdminOrder | null; onClose: () => void }) {
    const { money } = useBilling();
    const [tab, setTab] = useState<DetailTab>('overview');

    if (!order) return null;

    const tabs: { id: DetailTab; label: string }[] = [
        { id: 'overview', label: m['billing.orders.detail.tabs.overview']() },
        { id: 'customer', label: m['admin.billing.orders.detail.customer']() },
        { id: 'payment', label: m['billing.orders.detail.tabs.payment']() },
        { id: 'threat', label: m['admin.billing.orders.detail.threat']() },
    ];

    return (
        <Modal
            open={!!order}
            onClose={onClose}
            size="lg"
            title={`${order.serverName || order.name || m['billing.orders.detail.order']()} · #${order.id}`}
            description={order.productName ? `${order.productName} — ${money(order.total)}` : money(order.total)}
        >
            <div className="flex flex-col gap-5">
                <div className="flex gap-1 border-b border-[var(--color-border)]">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={cn(
                                'relative px-4 py-2 text-sm font-medium transition-colors',
                                tab === t.id
                                    ? 'text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                            )}
                        >
                            {t.label}
                            {tab === t.id && (
                                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--brand)]" />
                            )}
                        </button>
                    ))}
                </div>

                {tab === 'overview' && <OverviewTab order={order} />}
                {tab === 'customer' && <CustomerTab order={order} />}
                {tab === 'payment' && <PaymentTab order={order} />}
                {tab === 'threat' && <ThreatTab order={order} />}
            </div>
        </Modal>
    );
}
