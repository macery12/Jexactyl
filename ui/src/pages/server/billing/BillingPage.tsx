import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Clock, CalendarDays, Box, CheckCircle2 } from 'lucide-react';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useBilling } from '@/state/billing';
import { Spinner } from '@/components/ui/Spinner';
import { getStoreProduct, getProductBillingCycles } from '@/api/accountBilling';
import { buildBillingModel, type RenewalSettings, type RenewalState } from './billingModel';
import { RenewalPanel } from './RenewalPanel';
import { ChangePlanPanel } from './ChangePlanPanel';
import { ChangeEggPanel } from './ChangeEggPanel';
import { Notice } from './parts';

// Server billing cockpit: renewal state up top, then the actions (renew,
// change plan, change server type). Ported from V1's ServerBillingContainer +
// ChangePlanContainer + ChangeEggContainer (the last of which V1 kept under
// Settings). All data comes from the existing /api/client/billing endpoints.
export default function BillingPage() {
    const server = useServer();
    const { money, billing } = useBilling();
    const renewalSettings = (useFlags(s => s.everest?.billing?.renewal) as RenewalSettings | undefined) ?? {};

    const productId = server.billingProductId;

    const productQ = useQuery({
        queryKey: ['store', 'product', productId],
        queryFn: () => getStoreProduct(productId!),
        enabled: !!productId,
        // A deleted product is an expected state (V1 warns about it), not an error worth retrying.
        retry: false,
    });
    const cyclesQ = useQuery({
        queryKey: ['store', 'cycles', productId],
        queryFn: () => getProductBillingCycles(productId!),
        enabled: !!productId,
    });

    const product = productQ.data;
    const cycle = cyclesQ.data?.find(c => c.days === server.billingDays) ?? null;
    const loading = !!productId && (productQ.isLoading || cyclesQ.isLoading);

    const model = buildBillingModel({
        renewalDate: server.renewalDate,
        serverBillingDays: server.billingDays,
        isSuspended: server.status === 'suspended',
        product,
        cycle,
        renewal: renewalSettings,
    });

    const settingsPath = `/server/${server.id}/settings`;

    if (loading) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.billing.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.billing.subtitle']()}</p>
            </div>

            {server.isDeletionScheduled && server.renewalDate && (
                <Notice tone="danger" icon={AlertTriangle}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                            {m['server.billing.deletionScheduled']({ date: formatDate(server.renewalDate) })}
                        </span>
                        <Link
                            to={settingsPath}
                            className="shrink-0 text-xs font-medium text-[var(--color-ink)] underline underline-offset-2"
                        >
                            {m['server.billing.manageDeletion']()}
                        </Link>
                    </div>
                </Notice>
            )}

            {!product && <Notice tone="warning">{m['server.billing.productMissing']()}</Notice>}
            {!server.renewalDate && <Notice tone="warning">{m['server.billing.noRenewalDate']()}</Notice>}

            {server.renewalDate && <StatusStrip model={model} product={product} money={money} />}

            <div className="grid gap-4 lg:grid-cols-2">
                <RenewalPanel model={model} product={product} cycles={cyclesQ.data ?? []} />
                <div className="flex flex-col gap-4">
                    <ChangePlanPanel currency={billing.currency.code} />
                    <ChangeEggPanel />
                </div>
            </div>
        </div>
    );
}

// Status-led hero: the state badge, when it renews, and what it costs — the
// three things someone opening this page came to check.
function StatusStrip({
    model,
    product,
    money,
}: {
    model: ReturnType<typeof buildBillingModel>;
    product: { name: string; description: string | null } | undefined;
    money: (n: number) => string;
}) {
    return (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-8">
                <StateBadge state={model.state} />

                <div className="grid flex-1 gap-4 sm:grid-cols-3">
                    <Metric icon={Clock} label={m['server.billing.remaining']()}>
                        {model.daysRemaining >= 0
                            ? m['server.billing.remainingValue']({
                                  days: model.daysRemaining,
                                  hours: model.hoursRemaining,
                              })
                            : m['server.billing.overdueValue']({ days: model.daysOverdue })}
                    </Metric>
                    <Metric icon={Box} label={m['server.billing.package']()}>
                        {product?.name ?? m['server.billing.unknownPackage']()}
                    </Metric>
                    <Metric icon={CalendarDays} label={m['server.billing.cost']()}>
                        {m['server.billing.costValue']({
                            price: money(model.price),
                            days: model.billingDays,
                        })}
                    </Metric>
                </div>
            </div>

            {model.cycle && model.cycle.discountPercent !== 0 && (
                <p
                    className={`border-t border-[var(--color-border)] px-4 py-2 text-[11px] ${
                        model.cycle.discountPercent > 0
                            ? 'text-[var(--color-accent)]'
                            : 'text-[var(--color-warning)]'
                    }`}
                >
                    {model.cycle.discountPercent > 0
                        ? m['server.billing.cycleDiscount']({ percent: model.cycle.discountPercent.toFixed(1) })
                        : m['server.billing.cyclePremium']({
                              percent: Math.abs(model.cycle.discountPercent).toFixed(1),
                          })}
                </p>
            )}

            <div className="border-t border-[var(--color-border)] px-4 py-2">
                <Link
                    to="/account/billing/orders"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand)] hover:text-[var(--brand-hover)]"
                >
                    {m['server.billing.viewOrders']()}
                    <ArrowRight className="h-3 w-3" />
                </Link>
            </div>
        </section>
    );
}

const STATE_STYLES: Record<RenewalState, { tone: string; icon: typeof Clock }> = {
    active: { tone: 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]', icon: CheckCircle2 },
    available: { tone: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]', icon: Clock },
    grace: { tone: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]', icon: Clock },
    overdue: { tone: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]', icon: AlertTriangle },
};

const STATE_LABEL: Record<RenewalState, () => string> = {
    active: () => m['server.billing.state.active'](),
    available: () => m['server.billing.state.available'](),
    grace: () => m['server.billing.state.grace'](),
    overdue: () => m['server.billing.state.overdue'](),
};

function StateBadge({ state }: { state: RenewalState }) {
    const { tone, icon: Icon } = STATE_STYLES[state];

    return (
        <span
            className={`inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-[0.1em] ${tone}`}
        >
            <Icon className="h-3.5 w-3.5" />
            {STATE_LABEL[state]()}
        </span>
    );
}

function Metric({
    icon: Icon,
    label,
    children,
}: {
    icon: typeof Clock;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-2.5">
            <Icon className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                    {label}
                </p>
                <p className="truncate text-sm text-[var(--color-ink)]">{children}</p>
            </div>
        </div>
    );
}

function formatDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}
