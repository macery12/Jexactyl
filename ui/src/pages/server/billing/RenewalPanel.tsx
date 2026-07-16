import { lazy, Suspense, useEffect, useState } from 'react';
import { abs } from '@/lib/base';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Elements } from '@stripe/react-stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { CreditCard, AlertTriangle } from 'lucide-react';
import { m } from '@/i18n';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useServer } from '@/components/server/ServerContext';
import { useBilling } from '@/state/billing';
import { useFlashes } from '@/state/flashes';
import { loadStripeOnce } from '@/lib/stripe';
import {
    getStripeIntent,
    getStripeKey,
    type ProductCycle,
    type StoreProduct,
    type StripeIntent,
    type ValidateCouponResponse,
} from '@/api/accountBilling';
import { renewFreeServer } from '@/api/serverBilling';
import type { BillingModel } from './billingModel';
import { Notice, CyclePicker, CouponField } from './parts';

// The card form is the heavy import (Stripe Elements); only pull it in when a
// paid renewal actually needs it.
const RenewalStripeForm = lazy(() => import('./RenewalStripeForm'));

type Method = 'stripe' | 'paypal';

// Renew this server for another cycle. Three paths, same as V1: free plans
// renew directly, coupons that zero the total renew directly, and everything
// else goes through Stripe or PayPal.
export function RenewalPanel({
    model,
    product,
    cycles,
}: {
    model: BillingModel;
    product: StoreProduct | undefined;
    cycles: ProductCycle[];
}) {
    const server = useServer();
    const { money, stripeEnabled, paypalEnabled } = useBilling();
    const push = useFlashes(s => s.push);

    // Renewal doubles as a chance to switch cycle length, so this starts at the
    // server's current cycle rather than the product default.
    const [renewalDays, setRenewalDays] = useState<number | null>(server.billingDays);
    const [coupon, setCoupon] = useState<ValidateCouponResponse | null>(null);

    const effectiveDays = renewalDays ?? server.billingDays ?? model.billingDays;

    // Price the cycle the user actually picked — not the one the server is on
    // today — so the figure shown, the coupon subtotal, and the amount the
    // backend charges all agree.
    const selectedCycle = cycles.find(c => c.days === effectiveDays);
    const subtotal = selectedCycle?.price ?? model.price;
    const total = coupon ? coupon.total : subtotal;
    const freeRenewal = total === 0;

    // A coupon's discount was computed against the previous subtotal, so a cycle
    // change invalidates it. Drop it and let the user re-apply against the new
    // amount rather than quoting a total the backend won't honour.
    const selectCycle = (days: number) => {
        if (days === effectiveDays) return;
        setRenewalDays(days);
        setCoupon(null);
    };

    const renew = useMutation({
        mutationFn: () => renewFreeServer(product!.id, server.internalId, coupon?.coupon.id, effectiveDays),
        // A renewal moves the renewal date, the server status, and possibly the
        // limits. Reloading is how V1 resynced all of it, and it's still the
        // honest option here.
        onSuccess: () => window.location.reload(),
        onError: () => push({ type: 'error', message: m['server.billing.renewError']() }),
    });

    if (server.isDeletionScheduled) {
        return (
            <Panel title={m['server.billing.renewal']()} icon={CreditCard}>
                <div className="space-y-3">
                    <Notice tone="warning">{m['server.billing.deletionBlocksRenewal']()}</Notice>
                    <Link to={`/server/${server.id}/settings`}>
                        <Button variant="outline" size="sm">
                            {m['server.billing.manageDeletion']()}
                        </Button>
                    </Link>
                </div>
            </Panel>
        );
    }

    if (!product) {
        return (
            <Panel title={m['server.billing.renewal']()} icon={CreditCard}>
                <Notice tone="danger" icon={AlertTriangle}>
                    {m['server.billing.productMissingRenew']()}
                </Notice>
            </Panel>
        );
    }

    if (model.paymentDisabled) {
        return (
            <Panel title={m['server.billing.renewal']()} icon={CreditCard}>
                <Notice tone="danger" icon={AlertTriangle}>
                    {m['server.billing.suspendedTooLong']({ days: model.maxSuspensionDays })}
                </Notice>
            </Panel>
        );
    }

    // Free plans can't be renewed arbitrarily far ahead — only once inside the
    // grace window.
    if (model.isFree && model.daysRemaining > model.gracePeriod) {
        return (
            <Panel title={m['server.billing.renewal']()} icon={CreditCard}>
                <div className="space-y-3">
                    <p className="text-xs text-[var(--color-ink-muted)]">
                        {m['server.billing.freeServerNote']({ days: model.gracePeriod })}
                    </p>
                    <Notice tone="info">
                        {m['server.billing.renewableIn']({ days: model.renewableInDays })}
                    </Notice>
                </div>
            </Panel>
        );
    }

    return (
        <Panel title={m['server.billing.renewal']()} icon={CreditCard}>
            <div className="space-y-4">
                {model.isFree ? (
                    <p className="text-xs text-[var(--color-ink-muted)]">
                        {model.daysRemaining >= 0
                            ? m['server.billing.renewForDays']({ days: effectiveDays })
                            : m['server.billing.gracePeriodUsage']({
                                  used: model.daysOverdue,
                                  total: model.gracePeriod,
                              })}
                    </p>
                ) : (
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                            {m['server.billing.renewalCost']()}
                        </p>
                        {coupon ? (
                            <div className="mt-1">
                                <p className="font-mono text-xs tabular-nums text-[var(--color-ink-faint)] line-through">
                                    {money(coupon.subtotal)}
                                </p>
                                <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
                                    {money(coupon.total)}
                                </p>
                                <p className="text-[11px] font-medium text-[var(--color-accent)]">
                                    {m['server.billing.couponSaves']({ amount: money(coupon.discount) })}
                                </p>
                            </div>
                        ) : (
                            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
                                {money(subtotal)}
                            </p>
                        )}
                    </div>
                )}

                {cycles.length > 1 && (
                    <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                            {m['server.billing.selectCycle']()}
                        </p>
                        <CyclePicker
                            cycles={cycles}
                            selected={effectiveDays}
                            onSelect={selectCycle}
                            disabled={renew.isPending}
                        />
                    </div>
                )}

                {!model.isFree && (
                    <CouponField
                        subtotal={subtotal}
                        applied={coupon}
                        onChange={setCoupon}
                        disabled={renew.isPending}
                    />
                )}

                {freeRenewal ? (
                    <div className="space-y-2">
                        {coupon && (
                            <p className="text-xs text-[var(--color-accent)]">
                                {m['server.billing.couponMadeFree']()}
                            </p>
                        )}
                        <Button
                            className="w-full"
                            disabled={renew.isPending}
                            onClick={() => renew.mutate()}
                        >
                            {renew.isPending ? <Spinner className="h-4 w-4" /> : m['server.billing.renewServer']()}
                        </Button>
                    </div>
                ) : (
                    <PaymentMethods
                        product={product}
                        couponId={coupon?.coupon.id}
                        billingDays={effectiveDays}
                        stripeEnabled={stripeEnabled}
                        paypalEnabled={paypalEnabled}
                    />
                )}
            </div>
        </Panel>
    );
}

// Stripe card form and/or a PayPal handoff, mirroring V1's PaymentContainer.
function PaymentMethods({
    product,
    couponId,
    billingDays,
    stripeEnabled,
    paypalEnabled,
}: {
    product: StoreProduct;
    couponId?: number;
    billingDays?: number;
    stripeEnabled: boolean;
    paypalEnabled: boolean;
}) {
    const methods: Method[] = [
        ...(stripeEnabled ? (['stripe'] as const) : []),
        ...(paypalEnabled ? (['paypal'] as const) : []),
    ];
    const [method, setMethod] = useState<Method | undefined>(methods[0]);

    const [stripe, setStripe] = useState<Stripe | null>(null);
    const [intent, setIntent] = useState<StripeIntent | null>(null);

    // The intent embeds the amount, so a coupon or cycle change has to mint a
    // fresh one — the <Elements key> below then remounts the card form.
    useEffect(() => {
        if (!stripeEnabled) return;
        let cancelled = false;

        (async () => {
            try {
                const next = await getStripeIntent(product.id, couponId, billingDays);
                const { key } = await getStripeKey(product.id);
                const instance = await loadStripeOnce(key);
                if (cancelled) return;
                setIntent(next);
                setStripe(instance);
            } catch {
                if (!cancelled) setIntent(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [product.id, couponId, billingDays, stripeEnabled]);

    if (methods.length === 0) {
        return <Notice tone="warning">{m['billing.payment.noMethods']()}</Notice>;
    }

    return (
        <div className="space-y-3">
            {methods.length > 1 && (
                <div className="grid grid-cols-2 gap-2">
                    {methods.map(option => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setMethod(option)}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                method === option
                                    ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                    : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)]'
                            }`}
                        >
                            {option === 'stripe' ? m['server.billing.card']() : m['server.billing.paypal']()}
                        </button>
                    ))}
                </div>
            )}

            {method === 'stripe' ? (
                !intent || !stripe ? (
                    <div className="flex justify-center py-6">
                        <Spinner className="h-6 w-6" />
                    </div>
                ) : (
                    <Suspense
                        fallback={
                            <div className="flex justify-center py-6">
                                <Spinner className="h-6 w-6" />
                            </div>
                        }
                    >
                        <Elements
                            stripe={stripe}
                            key={intent.id}
                            options={{ clientSecret: intent.secret, appearance: { theme: 'night' } }}
                        >
                            <RenewalStripeForm
                                productId={product.id}
                                intentId={intent.id}
                                billingDays={billingDays}
                            />
                        </Elements>
                    </Suspense>
                )
            ) : method === 'paypal' ? (
                <Suspense fallback={<Spinner className="h-6 w-6" />}>
                    <PayPalRenewalButton productId={product.id} couponId={couponId} />
                </Suspense>
            ) : null}
        </div>
    );
}

function PayPalRenewalButton({ productId, couponId }: { productId: number; couponId?: number }) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const [loading, setLoading] = useState(false);

    const start = async () => {
        setLoading(true);
        try {
            const { createRenewalPayPalOrder } = await import('@/api/serverBilling');
            const order = await createRenewalPayPalOrder({
                productId,
                serverId: server.internalId,
                couponId,
                returnUrl: window.location.origin + abs(`/account/billing/processing?renewal=true&server=${server.id}&processor=paypal`),
                cancelUrl: window.location.origin + abs('/account/billing/cancel'),
            });
            window.location.href = `/api/client/billing/paypal/orders/${order.id}/redirect`;
        } catch {
            push({ type: 'error', message: m['billing.payment.startPaypalError']() });
            setLoading(false);
        }
    };

    return (
        <Button className="w-full" disabled={loading} onClick={start}>
            {loading ? <Spinner className="h-4 w-4" /> : m['billing.payment.payWithPaypal']()}
        </Button>
    );
}
