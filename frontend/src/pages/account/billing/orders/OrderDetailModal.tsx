import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/ui/Modal';
import type { Order } from '@/api/orders';
import { StatusPill, ProcessorBadge, orderTypeLabel, money } from './parts';

type DetailTab = 'overview' | 'payment' | 'timeline';

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

// A label/value pair row inside a detail card.
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

function OverviewTab({ order }: { order: Order }) {
    return (
        <div className="flex flex-col gap-5">
            <Card title={m['billing.orders.detail.orderInfo']()}>
                <Row label={m['billing.orders.col.id']()}>{mono(`#${order.id}`)}</Row>
                <Row label={m['billing.orders.detail.name']()}>{order.name || '—'}</Row>
                <Row label={m['billing.orders.col.type']()}>{orderTypeLabel(order.type)}</Row>
                <Row label={m['billing.orders.col.status']()}>
                    <StatusPill status={order.status} />
                </Row>
                <Row label={m['billing.orders.detail.created']()}>{fmtDate(order.createdAt)}</Row>
                {order.updatedAt && (
                    <Row label={m['billing.orders.detail.updated']()}>{fmtDate(order.updatedAt)}</Row>
                )}
            </Card>

            <Card title={m['billing.orders.detail.productBilling']()}>
                <Row label={m['billing.orders.detail.product']()}>
                    {order.productName ?? `#${order.productId}`}
                </Row>
                {order.description && (
                    <Row label={m['billing.orders.detail.description']()}>{order.description}</Row>
                )}
                {order.serverName && (
                    <Row label={m['billing.orders.col.server']()}>{order.serverName}</Row>
                )}
                {order.billingDays != null && (
                    <Row label={m['billing.orders.col.period']()}>
                        {m['billing.orders.detail.days']({ count: order.billingDays })}
                    </Row>
                )}
                {order.subtotal != null && (
                    <Row label={m['billing.orders.detail.subtotal']()}>{money(order.subtotal)}</Row>
                )}
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

function dashboardUrl(order: Order): string | null {
    const ext = order.transaction?.externalId;
    if (!ext) return null;
    if (order.paymentProcessor === 'stripe') return `https://dashboard.stripe.com/payments/${ext}`;
    if (order.paymentProcessor === 'paypal') return `https://www.paypal.com/activity/payment/${ext}`;
    return null;
}

function PaymentTab({ order }: { order: Order }) {
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
                    <Row label={m['billing.orders.detail.payment']()}>
                        {m['billing.orders.detail.noPayment']()}
                    </Row>
                ) : tx ? (
                    <>
                        {tx.externalId && (
                            <Row label={m['billing.orders.detail.reference']()}>{mono(tx.externalId)}</Row>
                        )}
                        {tx.captureId && (
                            <Row label={m['billing.orders.detail.captureId']()}>{mono(tx.captureId)}</Row>
                        )}
                        {tx.amount != null && (
                            <Row label={m['billing.orders.detail.amount']()}>
                                {money(tx.amount, tx.currency ?? 'USD')}
                            </Row>
                        )}
                        {tx.status && (
                            <Row label={m['billing.orders.col.status']()}>
                                <span className="capitalize">{tx.status}</span>
                            </Row>
                        )}
                        {tx.payerEmail && (
                            <Row label={m['billing.orders.detail.payer']()}>{tx.payerEmail}</Row>
                        )}
                        {tx.capturedAt && (
                            <Row label={m['billing.orders.detail.capturedAt']()}>{fmtDate(tx.capturedAt)}</Row>
                        )}
                    </>
                ) : (
                    <Row label={m['billing.orders.detail.payment']()}>
                        {m['billing.orders.detail.noTransaction']()}
                    </Row>
                )}
            </Card>
        </div>
    );
}

function TimelineTab({ order }: { order: Order }) {
    const events: { label: string; at: string | null }[] = [
        { label: m['billing.orders.timeline.placed'](), at: order.createdAt },
        order.transaction?.capturedAt
            ? { label: m['billing.orders.timeline.captured'](), at: order.transaction.capturedAt }
            : null,
        order.updatedAt ? { label: m['billing.orders.timeline.updated'](), at: order.updatedAt } : null,
    ].filter(Boolean) as { label: string; at: string | null }[];

    return (
        <ol className="flex flex-col gap-4">
            {events.map((e, i) => (
                <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />
                        {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--color-border)]" />}
                    </div>
                    <div className="pb-1">
                        <p className="text-sm text-[var(--color-ink)]">{e.label}</p>
                        <p className="text-xs text-[var(--color-ink-faint)]">{fmtDate(e.at)}</p>
                    </div>
                </li>
            ))}
        </ol>
    );
}

export default function OrderDetailModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
    const [tab, setTab] = useState<DetailTab>('overview');

    if (!order) return null;

    const tabs: { id: DetailTab; label: string }[] = [
        { id: 'overview', label: m['billing.orders.detail.tabs.overview']() },
        { id: 'payment', label: m['billing.orders.detail.tabs.payment']() },
        { id: 'timeline', label: m['billing.orders.detail.tabs.timeline']() },
    ];

    return (
        <Modal
            open={!!order}
            onClose={onClose}
            size="lg"
            title={`${order.serverName || order.name || m['billing.orders.detail.order']()} · #${order.id}`}
            description={
                order.productName
                    ? `${order.productName} — ${money(order.total)}`
                    : money(order.total)
            }
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
                {tab === 'payment' && <PaymentTab order={order} />}
                {tab === 'timeline' && <TimelineTab order={order} />}
            </div>
        </Modal>
    );
}
