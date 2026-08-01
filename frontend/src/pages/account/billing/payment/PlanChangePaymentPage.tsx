import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { abs } from '@/lib/base';
import { formatCurrency } from '@/lib/format';
import { loadStripeOnce } from '@/lib/stripe';
import { firstError } from '@/lib/apiError';
import { Spinner } from '@/components/ui/Spinner';
import { useBilling } from '@/state/billing';
import { useFlashes } from '@/state/flashes';
import {
    createPayPalOrder,
    getStoreProduct,
    getStripeIntent,
    getStripeKey,
    type PayPalOrder,
    type StripeIntent,
} from '@/api/accountBilling';
import { validatePlanChange } from '@/api/serverBilling';

const StripeForm = lazy(() => import('./StripeForm'));
const PayPalButton = lazy(() => import('./PayPalButton'));

type Method = 'stripe' | 'paypal';
type LockedPayment = { method: Method; amountMinor: number; currency: string };

// This page deliberately re-quotes the plan change instead of trusting values
// passed from the server billing screen. Provider intents/orders are then
// created with only the target product, owner-scoped server and a nonce; the
// backend owns the amount, cycle, renewal date and source-plan snapshot.
export default function PlanChangePaymentPage() {
    const [params] = useSearchParams();
    const push = useFlashes(s => s.push);
    const { money, stripeEnabled, paypalEnabled } = useBilling();

    const productId = Number(params.get('product') ?? 0);
    const serverIdentifier = params.get('server') ?? '';
    const serverId = Number(params.get('server_id') ?? 0);
    const checkoutNonce = params.get('checkout_nonce') ?? '';
    const processingUrl =
        window.location.origin
        + abs(`/billing/processing?plan_change=true&server=${encodeURIComponent(serverIdentifier)}`);
    const paypalReturnUrl =
        window.location.origin
        + abs(`/billing/processing?processor=paypal&plan_change=true&server=${encodeURIComponent(serverIdentifier)}`);
    const paypalCancelUrl =
        window.location.origin
        + abs(`/billing/cancel?plan_change=true&server=${encodeURIComponent(serverIdentifier)}`);

    const productQ = useQueryCompat({
        key: ['store', 'product', productId],
        load: () => getStoreProduct(productId),
        enabled: productId > 0,
    });
    const quoteQ = useQueryCompat({
        key: ['server', serverIdentifier, 'billing', 'plan-change-quote', productId],
        load: () => validatePlanChange(serverIdentifier, productId),
        enabled: productId > 0 && serverIdentifier.length > 0 && serverId > 0,
    });

    const [intent, setIntent] = useState<StripeIntent | null>(null);
    const [stripe, setStripe] = useState<Stripe | null>(null);
    const [paypalOrder, setPaypalOrder] = useState<PayPalOrder | null>(null);
    const [lockedPayment, setLockedPayment] = useState<LockedPayment | null>(null);
    const availableMethods = useMemo<Method[]>(
        () => [...(stripeEnabled ? (['stripe'] as const) : []), ...(paypalEnabled ? (['paypal'] as const) : [])],
        [stripeEnabled, paypalEnabled],
    );
    const [method, setMethod] = useState<Method | undefined>();

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- select the only available provider automatically
        if (!method && availableMethods.length === 1) setMethod(availableMethods[0]);
    }, [availableMethods, method]);

    const quote = quoteQ.data;
    const quotedServerId = quote?.quote.server_id;
    const resolvedServerId = quotedServerId ?? serverId;
    const canPay =
        !!quote?.valid
        && quote.mode === 'pay_now'
        && quote.quote.amount_due > 0
        && (quotedServerId === undefined || quotedServerId === serverId);

    useEffect(() => {
        if (!canPay || method !== 'stripe' || !stripeEnabled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale provider state when the live quote/method changes
            setIntent(null);
            setStripe(null);
            setLockedPayment(current => current?.method === 'stripe' ? null : current);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const intentData = await getStripeIntent(productId, undefined, undefined, {
                    planChange: true,
                    serverId: resolvedServerId,
                    checkoutNonce,
                });
                if (cancelled) return;
                setLockedPayment(toLockedPayment('stripe', intentData));
                setIntent(intentData);
                const { key } = await getStripeKey(productId);
                const instance = await loadStripeOnce(key);
                if (!cancelled) setStripe(instance);
            } catch (error) {
                if (!cancelled) {
                    push({ type: 'error', message: firstError(error) ?? m['billing.payment.cardError']() });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [canPay, checkoutNonce, method, productId, push, resolvedServerId, stripeEnabled]);

    useEffect(() => {
        if (!canPay || method !== 'paypal' || !paypalEnabled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale provider state when the live quote/method changes
            setPaypalOrder(null);
            setLockedPayment(current => current?.method === 'paypal' ? null : current);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const order = await createPayPalOrder(
                    productId,
                    undefined,
                    undefined,
                    paypalReturnUrl,
                    paypalCancelUrl,
                    {
                        planChange: true,
                        serverId: resolvedServerId,
                        checkoutNonce,
                    },
                );
                if (cancelled) return;
                setLockedPayment(toLockedPayment('paypal', order));
                setPaypalOrder(order);
            } catch (error) {
                if (!cancelled) {
                    push({ type: 'error', message: firstError(error) ?? m['billing.payment.startPaypalError']() });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        canPay,
        checkoutNonce,
        method,
        paypalCancelUrl,
        paypalEnabled,
        paypalReturnUrl,
        productId,
        push,
        resolvedServerId,
    ]);

    const backPath = serverIdentifier ? `/server/${serverIdentifier}/billing` : '/';
    const invalidParams =
        productId <= 0
        || !serverIdentifier
        || serverId <= 0
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutNonce);

    if (invalidParams) {
        return (
            <div className="space-y-4">
                <BackLink to={backPath} />
                <Notice tone="warning">{m['server.billing.planPaymentMissing']()}</Notice>
            </div>
        );
    }

    if (productQ.loading || quoteQ.loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (productQ.error || quoteQ.error || !productQ.data || !quote) {
        return (
            <div className="space-y-4">
                <BackLink to={backPath} />
                <Notice tone="danger">{m['server.billing.planPaymentLoadError']()}</Notice>
            </div>
        );
    }

    if (quotedServerId !== undefined && quotedServerId !== serverId) {
        return (
            <div className="space-y-4">
                <BackLink to={backPath} />
                <Notice tone="danger">{m['server.billing.planPaymentMissing']()}</Notice>
            </div>
        );
    }

    if (!canPay) {
        return (
            <div className="space-y-4">
                <BackLink to={backPath} />
                <Notice tone={quote.valid ? 'warning' : 'danger'}>
                    {quote.message || m['server.billing.planPaymentNoLongerDue']()}
                </Notice>
            </div>
        );
    }

    const liveQuote = quote.quote;
    const dueCurrency = lockedPayment?.currency ?? liveQuote.currency;
    const dueAmount = lockedPayment ? lockedPayment.amountMinor / 100 : liveQuote.amount_due;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <BackLink to={backPath} />
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">
                    {m['server.billing.planPaymentTitle']()}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                    {m['server.billing.planPaymentSubtitle']()}
                </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
                <div className="space-y-6 lg:col-span-8">
                    <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                            {m['billing.payment.orderSummary']()}
                        </p>
                        <dl className="mt-4 space-y-2 text-sm">
                            <QuoteRow label={m['billing.payment.plan']()} value={productQ.data.name} />
                            <QuoteRow
                                label={m['server.billing.currentCyclePrice']()}
                                value={money(liveQuote.current_cycle_price)}
                            />
                            <QuoteRow
                                label={m['server.billing.targetCyclePrice']()}
                                value={money(liveQuote.target_cycle_price)}
                            />
                            <QuoteRow
                                label={m['server.billing.renewalUnchanged']()}
                                value={formatDateTime(liveQuote.renewal_date)}
                            />
                            <QuoteRow
                                label={m['server.billing.remaining']()}
                                value={formatRemaining(liveQuote.remaining_seconds)}
                            />
                        </dl>
                        <div className="mt-4">
                            <Notice tone="success">{m['server.billing.paymentSecurityNotice']()}</Notice>
                        </div>
                    </section>

                    <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                            {m['billing.payment.method']()}
                        </p>

                        {availableMethods.length === 0 ? (
                            <Notice tone="danger">{m['billing.payment.noMethods']()}</Notice>
                        ) : (
                            <div className="space-y-4">
                                {availableMethods.length > 1 && (
                                    <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-1">
                                        {availableMethods.map(candidate => (
                                            <button
                                                key={candidate}
                                                type="button"
                                                disabled={method !== undefined && method !== candidate}
                                                onClick={() => {
                                                    if (!method) setMethod(candidate);
                                                }}
                                                className={cn(
                                                    'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                                                    method === candidate
                                                        ? 'bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50',
                                                )}
                                            >
                                                <CreditCard className="h-4 w-4" />
                                                {candidate}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {method === 'stripe' ? (
                                    intent && stripe ? (
                                        <Elements
                                            key={intent.id}
                                            stripe={stripe}
                                            options={{ clientSecret: intent.secret, appearance: { theme: 'night' } }}
                                        >
                                            <Suspense fallback={<Spinner className="h-6 w-6" />}>
                                                <StripeForm returnUrl={processingUrl} />
                                            </Suspense>
                                        </Elements>
                                    ) : (
                                        <div className="flex items-center justify-center py-8">
                                            <Spinner className="h-6 w-6" />
                                        </div>
                                    )
                                ) : method === 'paypal' ? (
                                    paypalOrder ? (
                                        <Suspense fallback={<Spinner className="h-6 w-6" />}>
                                            <PayPalButton
                                                productId={productId}
                                                checkoutNonce={checkoutNonce}
                                                planChange
                                                serverId={resolvedServerId}
                                                serverIdentifier={serverIdentifier}
                                                preparedOrder={paypalOrder}
                                            />
                                        </Suspense>
                                    ) : (
                                        <div className="flex items-center justify-center py-8">
                                            <Spinner className="h-6 w-6" />
                                        </div>
                                    )
                                ) : null}
                            </div>
                        )}
                    </section>
                </div>

                <aside className="lg:col-span-4">
                    <div className="sticky top-24 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/80 p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                            {m['server.billing.dueNow']()}
                        </p>
                        <div className="mt-3 flex items-baseline gap-2">
                            <p className="font-mono text-3xl font-bold tabular-nums text-[var(--color-ink)]">
                                {formatCurrency(dueAmount, dueCurrency)}
                            </p>
                            <span className="text-xs font-medium uppercase text-[var(--color-ink-faint)]">
                                {dueCurrency}
                            </span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                            {m['server.billing.proratedForRemaining']({
                                time: formatRemaining(liveQuote.remaining_seconds),
                            })}
                        </p>
                        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-[11px] text-[var(--color-ink-faint)]">
                            {m['server.billing.noCycleReset']({
                                date: formatDateTime(liveQuote.renewal_date),
                                days: liveQuote.billing_days,
                            })}
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}

// A tiny wrapper keeps this file independent of query library result internals
// while preserving the same cache and retry behavior as the rest of billing.
function useQueryCompat<T>({ key, load, enabled }: { key: unknown[]; load: () => Promise<T>; enabled: boolean }) {
    const query = useQuery({ queryKey: key, queryFn: load, enabled, retry: false });
    return { data: query.data, loading: query.isLoading, error: query.isError };
}

function BackLink({ to }: { to: string }) {
    return (
        <Link
            to={to}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
            <ArrowLeft className="h-4 w-4" />
            {m['server.billing.backToServerBilling']()}
        </Link>
    );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <dt className="text-[var(--color-ink-muted)]">{label}</dt>
            <dd className="text-right font-medium text-[var(--color-ink)]">{value}</dd>
        </div>
    );
}

function Notice({ tone, children }: { tone: 'success' | 'warning' | 'danger'; children: React.ReactNode }) {
    const toneClass =
        tone === 'success'
            ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            : tone === 'warning'
              ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
              : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]';
    const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
    return (
        <div className={cn('flex items-center gap-2 rounded-lg border px-4 py-3 text-sm', toneClass)}>
            <Icon className="h-4 w-4 shrink-0" />
            {children}
        </div>
    );
}

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatRemaining(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return m['server.billing.remainingValue']({
        days: Math.floor(safe / 86_400),
        hours: Math.floor((safe % 86_400) / 3_600),
    });
}

function toLockedPayment(
    method: Method,
    payload: { amount_minor: number; currency: string },
): LockedPayment {
    const currency = payload.currency.toUpperCase();
    if (
        !Number.isSafeInteger(payload.amount_minor)
        || payload.amount_minor <= 0
        || !/^[A-Z]{3}$/.test(currency)
    ) {
        throw new Error('The payment provider returned an invalid locked amount.');
    }

    return { method, amountMinor: payload.amount_minor, currency };
}
