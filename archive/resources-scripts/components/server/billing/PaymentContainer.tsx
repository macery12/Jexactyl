import Spinner from '@/elements/Spinner';
import { Elements } from '@stripe/react-stripe-js';
import { Stripe } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';
import PaymentForm from './PaymentForm';
import PayPalRenewalForm from './PayPalRenewalForm';
import { ServerContext } from '@/state/server';
import { StripeIntent } from '@definitions/account/billing';
import { getStripeIntent, getStripeKey } from '@/api/routes/account/billing/orders/stripe';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { Alert } from '@/elements/alert';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { loadStripeOnce } from '@/lib/stripe';
import ProcessorSelectorGrid, { type PaymentMethod } from '@/components/billing/ProcessorSelectorGrid';

export default ({ id, couponId, billingDays }: { id?: number; couponId?: number; billingDays?: number }) => {
    const [stripe, setStripe] = useState<Stripe | null>(null);
    const [intent, setIntent] = useState<StripeIntent | null>(null);

    const serverId = ServerContext.useStoreState(state => state.server.data!.internalId);
    const serverUuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const billing = useStoreState(state => state.everest.data!.billing);

    const configuredProcessors: Array<{ method: PaymentMethod; available: boolean }> = [
        { method: 'stripe' as const, available: billing.processors?.stripe?.available ?? false },
        { method: 'paypal' as const, available: billing.processors?.paypal?.available ?? false },
    ].filter(p => {
        if (p.method === 'stripe') return billing.processors?.stripe?.enabled;
        return billing.processors?.paypal?.enabled;
    });

    const availableProcessors = configuredProcessors.filter(p => p.available).map(p => p.method);

    const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | undefined>(availableProcessors[0]);

    const showSelection = configuredProcessors.length > 1;

    useEffect(() => {
        const fetchData = async () => {
            // Only fetch Stripe data if Stripe is available and selected
            if (id && availableProcessors.includes('stripe')) {
                try {
                    const intentData = await getStripeIntent(id, couponId, billingDays);
                    setIntent({ id: intentData.id, secret: intentData.secret });

                    const stripePublicKey = await getStripeKey(id);
                    const stripeInstance = await loadStripeOnce(stripePublicKey.key);
                    setStripe(stripeInstance);
                } catch (error) {
                    console.error('Error fetching Stripe data:', error);
                }
            }
        };

        fetchData();
    }, [id, couponId, billingDays]);

    if (!id) return <Spinner size={'large'} centered />;

    // If no processors are available, show error message
    if (availableProcessors.length === 0) {
        return (
            <Alert type={'danger'}>
                <div className={'flex items-start gap-3'}>
                    <FontAwesomeIcon icon={faExclamationTriangle} className={'mt-0.5 h-5 w-5'} />
                    <div>
                        <p className={'font-semibold'}>No Payment Methods Available</p>
                        <p className={'mt-1 text-sm'}>Payment system has not been setup correctly.</p>
                    </div>
                </div>
            </Alert>
        );
    }

    const stripeOptions = {
        clientSecret: intent?.secret,
        appearance: {
            theme: 'night' as const,
            variables: {
                colorText: '#ffffff',
            },
        },
    };

    return (
        <div>
            <FlashMessageRender byKey={'suspended:billing'} className={'mb-4'} />

            {showSelection && (
                <ProcessorSelectorGrid
                    selected={selectedMethod}
                    onSelect={setSelectedMethod}
                    processors={configuredProcessors}
                />
            )}

            {/* Render the selected payment method */}
            {selectedMethod === 'stripe' ? (
                <>
                    {!intent || !stripe ? (
                        <Spinner size={'large'} centered />
                    ) : (
                        <div>
                            {/* Key prop forces re-mount when intent changes (e.g., coupon applied/removed) */}
                            <Elements stripe={stripe} options={stripeOptions} key={intent.id}>
                                <PaymentForm
                                    id={id}
                                    serverId={Number(serverId)}
                                    serverUuid={serverUuid}
                                    intent={intent.id}
                                    renewal
                                    billingDays={billingDays}
                                />
                            </Elements>
                        </div>
                    )}
                </>
            ) : selectedMethod === 'paypal' ? (
                <div>
                    <PayPalRenewalForm
                        id={id}
                        serverId={Number(serverId)}
                        serverUuid={serverUuid}
                        couponId={couponId}
                    />
                </div>
            ) : null}
        </div>
    );
};
