import { m } from '@/i18n';
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Elements } from '@stripe/react-stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { ArrowLeft, AlertTriangle, CheckCircle2, CreditCard } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { useBilling } from '@/state/billing';
import { loadStripeOnce } from '@/lib/stripe';
import {
    getStoreProduct,
    getProductBillingCycles,
    getViableNodes,
    getEggInfo,
    getStripeIntent,
    getStripeKey,
    validateCoupon,
    processFreeOrder,
    type StripeIntent,
    type ValidateCouponResponse,
} from '@/api/accountBilling';
import { readDraft, clearDraft } from '../order/draft';
import { SpecChips } from '../order/parts';

// Code-split the heavy Stripe form + PayPal button so they only load on the
// payment route.
const StripeForm = lazy(() => import('./StripeForm'));
const PayPalButton = lazy(() => import('./PayPalButton'));

type Method = 'stripe' | 'paypal';

export default function PaymentPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const { money, billing, stripeEnabled, paypalEnabled } = useBilling();

    const productId = Number(params.get('product') ?? 0);
    const draft = useMemo(() => readDraft(productId), [productId]);

    const productQ = useQuery({ queryKey: ['store', 'product', productId], queryFn: () => getStoreProduct(productId), enabled: productId > 0 });
    const cyclesQ = useQuery({ queryKey: ['store', 'cycles', productId], queryFn: () => getProductBillingCycles(productId), enabled: productId > 0 });
    const nodesQ = useQuery({ queryKey: ['store', 'nodes', productId], queryFn: () => getViableNodes(productId), enabled: productId > 0 });
    const eggQ = useQuery({ queryKey: ['store', 'egg', draft?.eggId], queryFn: () => getEggInfo(draft!.eggId as number), enabled: !!draft?.eggId });

    const product = productQ.data;
    const cycle = cyclesQ.data?.find(c => c.days === draft?.cycleDays);
    const basePrice = cycle?.price ?? product?.price ?? 0;

    const [couponData, setCouponData] = useState<ValidateCouponResponse | null>(draft?.couponData ?? null);
    const couponId = couponData?.coupon.id ?? draft?.couponId;
    const total = couponData ? couponData.total : basePrice;
    const isFree = total === 0;

    const [intent, setIntent] = useState<StripeIntent | null>(null);
    const [stripe, setStripe] = useState<Stripe | null>(null);
    const [creatingFree, setCreatingFree] = useState(false);

    const availableMethods = useMemo<Method[]>(
        () => [...(stripeEnabled ? (['stripe'] as const) : []), ...(paypalEnabled ? (['paypal'] as const) : [])],
        [stripeEnabled, paypalEnabled],
    );
    const [method, setMethod] = useState<Method | undefined>(undefined);
    useEffect(() => {
        if (!method && availableMethods.length > 0) setMethod(availableMethods[0]);
    }, [availableMethods, method]);

    // Re-validate the coupon against the live price (it may have changed).
    useEffect(() => {
        if (!draft?.couponData || !product) return;
        validateCoupon(draft.couponData.coupon.code, basePrice, 'new')
            .then(setCouponData)
            .catch(() => {
                setCouponData(null);
                push({ type: 'warning', message: m['billing.payment.couponRemoved']() });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id]);

    // Create / refresh the Stripe intent when paying by card.
    useEffect(() => {
        if (!product || isFree || method !== 'stripe' || !stripeEnabled) {
            setIntent(null);
            setStripe(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const intentData = await getStripeIntent(product.id, couponId, draft?.cycleDays);
                if (cancelled) return;
                setIntent(intentData);
                const { key } = await getStripeKey(product.id);
                const instance = await loadStripeOnce(key);
                if (!cancelled) setStripe(instance);
            } catch {
                if (!cancelled) push({ type: 'error', message: m['billing.payment.cardError']() });
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id, couponId, total, method, stripeEnabled]);

    if (!draft || productId <= 0) {
        return (
            <div className="space-y-4">
                <BackLink />
                <Notice tone="warning">{m['billing.payment.missingDraft']()}</Notice>
            </div>
        );
    }

    if (productQ.isLoading || cyclesQ.isLoading || nodesQ.isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (productQ.isError || !product) {
        return (
            <div className="space-y-4">
                <BackLink />
                <Notice tone="danger">{m['billing.payment.loadError']()}</Notice>
            </div>
        );
    }

    const node = nodesQ.data?.find(n => n.id === draft.nodeId);
    const varsPayload = draft.vars.map(([key, value]) => ({ key, value }));

    const createFree = async () => {
        setCreatingFree(true);
        try {
            await processFreeOrder({
                product: product.id,
                node: draft.nodeId,
                variables: varsPayload,
                coupon_id: couponId,
                egg_id: draft.eggId,
                name: draft.serverName,
                billing_days: draft.cycleDays,
            });
            clearDraft(productId);
            navigate('/billing/success');
        } catch {
            push({ type: 'error', message: m['billing.configure.createServerError']() });
            setCreatingFree(false);
        }
    };

    const summaryRows: [string, string][] = [
        [m['billing.payment.plan'](), product.name],
        [m['billing.payment.serverName'](), draft.serverName],
        [m['billing.payment.location'](), node?.name ?? '—'],
        [m['billing.payment.software'](), eggQ.data?.name ?? '—'],
        [m['billing.payment.billingCycle'](), cycle?.label ?? `${draft.cycleDays} days`],
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <BackLink />
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">{m['billing.payment.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['billing.payment.subtitle']()}</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
                <div className="space-y-6 lg:col-span-8">
                    <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                            {m['billing.payment.orderSummary']()}
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {summaryRows.map(([label, value]) => (
                                <div key={label}>
                                    <p className="text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</p>
                                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{value}</p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4">
                            <SpecChips limits={product.limits} />
                        </div>
                    </div>

                    <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                            {m['billing.payment.method']()}
                        </p>

                        {isFree ? (
                            <div className="space-y-4">
                                <Notice tone="success">
                                    {couponId ? m['billing.payment.freeNoticeCoupon']() : m['billing.payment.freeNotice']()}
                                </Notice>
                                <Button size="lg" className="w-full" disabled={creatingFree} onClick={createFree}>
                                    {creatingFree ? <Spinner className="h-5 w-5" /> : m['billing.payment.createServer']()}
                                </Button>
                            </div>
                        ) : availableMethods.length === 0 ? (
                            <Notice tone="danger">{m['billing.payment.noMethods']()}</Notice>
                        ) : (
                            <div className="space-y-4">
                                {availableMethods.length > 1 && (
                                    <div className="inline-flex rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-1">
                                        {availableMethods.map(m => (
                                            <button
                                                key={m}
                                                type="button"
                                                onClick={() => setMethod(m)}
                                                className={cn(
                                                    'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                                                    method === m
                                                        ? 'bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                                                )}
                                            >
                                                <CreditCard className="h-4 w-4" /> {m}
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
                                            <LazyStripeForm
                                                productId={product.id}
                                                intentId={intent.id}
                                                nodeId={draft.nodeId}
                                                vars={varsPayload}
                                                couponId={couponId}
                                                eggId={draft.eggId}
                                                serverName={draft.serverName}
                                                billingDays={draft.cycleDays}
                                            />
                                        </Elements>
                                    ) : (
                                        <div className="flex items-center justify-center py-8">
                                            <Spinner className="h-6 w-6" />
                                        </div>
                                    )
                                ) : method === 'paypal' ? (
                                    <LazyPayPalButton
                                        productId={product.id}
                                        nodeId={draft.nodeId}
                                        vars={varsPayload}
                                        couponId={couponId}
                                        eggId={draft.eggId}
                                        serverName={draft.serverName}
                                        billingDays={draft.cycleDays}
                                    />
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>

                {/* Totals */}
                <div className="lg:col-span-4">
                    <div className="sticky top-24 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/80 p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                            {m['billing.payment.total']()}
                        </p>
                        <div className="mt-3 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[var(--color-ink-muted)]">{m['billing.payment.subtotal']()}</span>
                                <span className="font-medium text-[var(--color-ink)]">{money(basePrice)}</span>
                            </div>
                            {couponData && couponData.discount > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--color-accent)]">
                                        {m['billing.summary.coupon']({ code: couponData.coupon.code })}
                                    </span>
                                    <span className="font-medium text-[var(--color-accent)]">−{money(couponData.discount)}</span>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex items-end justify-between border-t border-[var(--color-border)] pt-4">
                            <span className="text-sm text-[var(--color-ink-muted)]">{m['billing.payment.dueToday']()}</span>
                            <span className="text-2xl font-bold text-[var(--color-ink)]">
                                {isFree ? m['billing.payment.free']() : money(total)}
                            </span>
                        </div>
                        <p className="mt-3 text-[11px] text-[var(--color-ink-faint)]">
                            {m['billing.payment.billedEvery']({ currency: billing.currency.code.toUpperCase(), days: draft.cycleDays })}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function LazyStripeForm(props: React.ComponentProps<typeof StripeForm>) {
    return (
        <Suspense fallback={<Spinner className="h-6 w-6" />}>
            <StripeForm {...props} />
        </Suspense>
    );
}
function LazyPayPalButton(props: React.ComponentProps<typeof PayPalButton>) {
    return (
        <Suspense fallback={<Spinner className="h-6 w-6" />}>
            <PayPalButton {...props} />
        </Suspense>
    );
}

function BackLink() {
    return (
        <Link
            to="/billing/order"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
            <ArrowLeft className="h-4 w-4" /> {m['billing.payment.back']()}
        </Link>
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
        <div className={cn('flex items-center gap-2 rounded-xl border px-4 py-3 text-sm', toneClass)}>
            <Icon className="h-4 w-4 shrink-0" /> {children}
        </div>
    );
}
