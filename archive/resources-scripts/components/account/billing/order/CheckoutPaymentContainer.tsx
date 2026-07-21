import Spinner from '@/elements/Spinner';
import PageContentBlock from '@/elements/PageContentBlock';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStoreState } from '@/state/hooks';
import { Alert } from '@/elements/alert';
import { Button } from '@/elements/button';
import SubtotalCard from '@account/billing/order/SubtotalCard';
import PaymentMethodSelector from './PaymentMethodSelector';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import {
    getProduct,
    getProductBillingCycles,
    getViableNodes,
    getEggInfo,
    type EggInfo,
    type BillingCycle,
} from '@/api/routes/account/billing/products';
import { Product, StripeIntent, type Node } from '@definitions/account/billing';
import { processUnpaidOrder } from '@/api/routes/account/billing/orders/process';
import { getStripeIntent, getStripeKey } from '@/api/routes/account/billing/orders/stripe';
import { loadStripeOnce } from '@/lib/stripe';
import { Stripe } from '@stripe/stripe-js';
import { ValidateCouponResponse, validateCoupon } from '@/api/routes/account/billing/coupons';
import { useCheckoutDraft } from '@/hooks/useCheckoutDraft';
import { getBillingProfile, type BillingProfile } from '@/api/routes/account/billing/billingProfile';

interface CheckoutState {
    productId: number;
    selectedNode: number;
    selectedBillingDays: number;
    selectedEggId?: number;
    vars?: [string, string][];
    couponId?: number;
    couponData?: ValidateCouponResponse | null;
    serverName: string;
}

const hasCompleteBillingProfile = (profile: BillingProfile | null): boolean => {
    if (!profile) {
        return false;
    }

    const requiredFields = [
        profile.first_name,
        profile.last_name,
        profile.address_line1,
        profile.city,
        profile.state,
        profile.postal_code,
        profile.country,
    ];

    return requiredFields.every(value => typeof value === 'string' && value.trim().length > 0);
};

export default () => {
    const { state } = useLocation();
    const navigate = useNavigate();
    const billing = useStoreState(s => s.everest.data!.billing);
    const { addFlash, clearAndAddHttpError, clearFlashes } = useFlash();
    const { colors } = useStoreState(s => s.theme.data!);

    const routerState = state as CheckoutState | undefined;

    // Fall back to sessionStorage draft when router state is missing (e.g. after a page refresh)
    const productIdHint = routerState?.productId ?? 0;
    const { draft } = useCheckoutDraft(productIdHint);
    const checkoutState: CheckoutState | undefined =
        routerState ?? (draft.productId ? (draft as unknown as CheckoutState) : undefined);

    const [product, setProduct] = useState<Product | undefined>();
    const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
    const [nodes, setNodes] = useState<Node[]>([]);
    const [selectedEgg, setSelectedEgg] = useState<EggInfo | undefined>();
    const [stripe, setStripe] = useState<Stripe | null>(null);
    const [intent, setIntent] = useState<StripeIntent | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [couponRevalidating, setCouponRevalidating] = useState<boolean>(false);
    const [couponWarning, setCouponWarning] = useState<string | undefined>();
    const [couponData, setCouponData] = useState<ValidateCouponResponse | null>(checkoutState?.couponData ?? null);
    const [couponId, setCouponId] = useState<number | undefined>(checkoutState?.couponId);

    const vars = useMemo(
        () => new Map<string, string>(checkoutState?.vars ? [...checkoutState.vars] : []),
        [checkoutState?.vars],
    );

    useEffect(() => {
        if (!checkoutState?.productId) {
            addFlash({
                key: 'account:billing:order',
                type: 'warning',
                message: 'Missing configuration details. Please configure your server again.',
            });
            navigate('/account/billing/order', { replace: true });
            return;
        }

        const loadData = async () => {
            try {
                const [productData, cyclesData, nodesData] = await Promise.all([
                    getProduct(checkoutState.productId),
                    getProductBillingCycles(checkoutState.productId),
                    getViableNodes(checkoutState.productId),
                ]);
                setProduct(productData);
                setBillingCycles(cyclesData);
                setNodes(nodesData);

                if (checkoutState.selectedEggId) {
                    const eggInfo = await getEggInfo(checkoutState.selectedEggId);
                    setSelectedEgg(eggInfo);
                }
            } catch (error) {
                clearAndAddHttpError({ key: 'account:billing:order', error });
            }
        };

        loadData();
    }, [checkoutState?.productId]);

    useEffect(() => {
        if (!billing.require_billing_address) {
            return;
        }

        getBillingProfile()
            .then(profile => {
                if (hasCompleteBillingProfile(profile)) {
                    return;
                }

                addFlash({
                    key: 'account:billing:order',
                    type: 'error',
                    message:
                        'Billing address verification is required before purchase. Please add your billing address in Account Overview first.',
                });
                navigate('/checkout/configure/' + checkoutState!.productId, { replace: true });
            })
            .catch(error => clearAndAddHttpError({ key: 'account:billing:order', error }));
    }, [billing.require_billing_address, checkoutState?.productId]);

    // Re-validate coupon on mount — price may have changed since step 1
    useEffect(() => {
        if (!checkoutState?.couponData || !product) return;

        const revalidate = async () => {
            setCouponRevalidating(true);
            setCouponWarning(undefined);
            try {
                const result = await validateCoupon(checkoutState.couponData!.coupon.code, product.price, 'new');
                setCouponData(result);
                setCouponId(result.coupon.id);
            } catch {
                // Coupon no longer valid — fall back to base price
                setCouponData(null);
                setCouponId(undefined);
                setCouponWarning('Your coupon is no longer valid and has been removed.');
            } finally {
                setCouponRevalidating(false);
            }
        };

        revalidate();
    }, [product?.id]);

    useEffect(() => {
        if (!product || product.price === 0) return;
        if (!billing.processors?.stripe?.available) return;

        // Skip intent creation if coupon makes order free
        if (couponData?.total === 0) {
            setIntent(null);
            setStripe(null);
            return;
        }

        const initializeStripe = async () => {
            try {
                const intentData = await getStripeIntent(product.id, couponId, checkoutState!.selectedBillingDays);
                setIntent({ id: intentData.id, secret: intentData.secret });

                const stripePublicKey = await getStripeKey(product.id);
                const stripeInstance = await loadStripeOnce(stripePublicKey.key);
                setStripe(stripeInstance);
            } catch (error) {
                console.error('Error initializing Stripe:', error);
            }
        };

        initializeStripe();
    }, [product?.id, couponId, couponData?.total, checkoutState?.selectedBillingDays]);

    if (!checkoutState?.productId) {
        return (
            <PageContentBlock title={'Payment'}>
                <FlashMessageRender byKey={'account:billing:order'} className={'mb-4'} />
                <Alert type={'warning'}>Missing checkout details. Please start your configuration again.</Alert>
            </PageContentBlock>
        );
    }

    if (!product) return <Spinner centered />;

    const createFree = async () => {
        clearFlashes();
        setLoading(true);

        try {
            const variables = Array.from(vars, ([key, value]) => ({ key, value }));
            await processUnpaidOrder(
                product.id,
                checkoutState.selectedNode,
                undefined,
                variables,
                undefined,
                couponId,
                checkoutState.selectedEggId,
                checkoutState.serverName,
                undefined,
                checkoutState.selectedBillingDays,
            );
            navigate('/account/billing/success');
        } catch (error) {
            setLoading(false);
            clearAndAddHttpError({ key: 'account:billing:order', error });
        }
    };

    const totalIsFree = product.price === 0 || couponData?.total === 0;

    const handleCouponApplied = (data: ValidateCouponResponse | null, status: 'applied' | 'removed' | 'invalid') => {
        if (status === 'invalid') return;

        setCouponData(data);
        setCouponId(data?.coupon.id);

        // Reset stripe data so it re-initializes with the new amount (or removal)
        setStripe(null);
        setIntent(null);
    };

    const summaryCard = (
        <div
            className={'rounded-lg border p-6 space-y-3'}
            style={{ backgroundColor: colors.secondary, borderColor: '#374151' }}
        >
            <h3 className={'text-lg font-semibold text-gray-200'}>Order Summary</h3>
            <div className={'grid grid-cols-2 gap-3 text-sm'}>
                <div>
                    <p className={'text-xs uppercase text-gray-500'}>Server</p>
                    <p className={'font-semibold text-gray-100'}>{product.name}</p>
                </div>
                <div>
                    <p className={'text-xs uppercase text-gray-500'}>Server Name</p>
                    <p className={'font-semibold text-gray-100'}>{checkoutState.serverName}</p>
                </div>
                <div>
                    <p className={'text-xs uppercase text-gray-500'}>Location</p>
                    <p className={'font-semibold text-gray-100'}>
                        {nodes.find(n => Number(n.id) === checkoutState.selectedNode)?.name || 'Not selected'}
                    </p>
                </div>
                <div>
                    <p className={'text-xs uppercase text-gray-500'}>Software</p>
                    <p className={'font-semibold text-gray-100'}>
                        {selectedEgg?.name || checkoutState.selectedEggId ? 'Selected' : 'Not selected'}
                    </p>
                </div>
                <div>
                    <p className={'text-xs uppercase text-gray-500'}>Billing Cycle</p>
                    <p className={'font-semibold text-gray-100'}>
                        {billingCycles.find(c => c.days === checkoutState.selectedBillingDays)?.label ??
                            `${checkoutState.selectedBillingDays} days`}
                    </p>
                </div>
            </div>
        </div>
    );

    return (
        <PageContentBlock title={'Payment'}>
            <FlashMessageRender byKey={'account:billing:order'} className={'mb-4'} />
            {couponWarning && (
                <Alert type={'warning'} className={'mb-4'}>
                    {couponWarning}
                </Alert>
            )}
            {couponRevalidating && (
                <Alert type={'info'} className={'mb-4'}>
                    Re-validating coupon…
                </Alert>
            )}
            <div className={'mb-8'}>
                <h1 className={'text-4xl font-bold text-gray-100'}>Payment</h1>
                <p className={'mt-2 text-base text-gray-400'}>
                    Review your configuration and select a payment method to complete your order.
                </p>
            </div>

            <div className={'grid gap-8 lg:grid-cols-12'}>
                <div className={'space-y-6 lg:col-span-8'}>
                    {summaryCard}

                    <div
                        className={'rounded-lg border p-6'}
                        style={{ backgroundColor: colors.secondary, borderColor: '#374151' }}
                    >
                        <h3 className={'mb-4 text-lg font-semibold text-gray-200'}>Payment Method</h3>
                        {totalIsFree ? (
                            <div className={'space-y-4'}>
                                <Alert type={'success'}>
                                    This order is free based on your selections{couponId ? ' or coupon' : ''}.
                                </Alert>
                                <Button
                                    size={Button.Sizes.Large}
                                    className={'w-full'}
                                    disabled={loading}
                                    onClick={() => void createFree()}
                                >
                                    {loading ? 'Creating...' : 'Create Server'}
                                </Button>
                            </div>
                        ) : (
                            <PaymentMethodSelector
                                selectedNode={checkoutState.selectedNode}
                                product={product}
                                vars={vars}
                                intent={intent}
                                stripe={stripe}
                                couponId={couponId}
                                billingDays={checkoutState.selectedBillingDays}
                                selectedEggId={checkoutState.selectedEggId}
                                serverName={checkoutState.serverName}
                            />
                        )}
                    </div>
                </div>

                <div className={'lg:col-span-4'}>
                    <div className={'sticky top-24'}>
                        <SubtotalCard
                            basePrice={product.price}
                            selectedNode={checkoutState.selectedNode}
                            nodes={nodes}
                            selectedEggId={checkoutState.selectedEggId}
                            availableEggs={selectedEgg ? [selectedEgg] : []}
                            selectedBillingDays={checkoutState.selectedBillingDays}
                            billingCycles={billingCycles}
                            couponDiscount={couponData?.discount || 0}
                            couponCode={couponData?.coupon.code}
                            productName={product.name}
                            showDetailedBreakdown={true}
                            showCouponInput={true}
                            onCouponApplied={handleCouponApplied}
                        />
                    </div>
                </div>
            </div>
        </PageContentBlock>
    );
};
