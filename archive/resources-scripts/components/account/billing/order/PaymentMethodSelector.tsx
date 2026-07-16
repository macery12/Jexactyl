import { useState } from 'react';
import { useStoreState } from '@/state/hooks';
import { Product, StripeIntent } from '@definitions/account/billing';
import PaymentButton from './PaymentButton';
import PayPalPaymentButton from './PayPalPaymentButton';
import { Elements } from '@stripe/react-stripe-js';
import { Stripe } from '@stripe/stripe-js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { Alert } from '@/elements/alert';
import ProcessorSelectorGrid, { type PaymentMethod } from '@/components/billing/ProcessorSelectorGrid';

interface Props {
    selectedNode?: number;
    product: Product;
    vars: Map<string, string>;
    intent: StripeIntent | null;
    stripe: Stripe | null;
    couponId?: number;
    billingDays: number;
    selectedEggId?: number;
    serverName: string;
    domainPayload?: Array<{
        domain_id: number;
        subdomain: string;
        record_type?: 'srv' | 'cname';
    }>;
}

type PaymentMethod = 'stripe' | 'paypal';

export default (props: Props) => {
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
        clientSecret: props.intent?.secret,
        appearance: {
            theme: 'night' as const,
            variables: {
                colorText: '#ffffff',
            },
        },
    };

    return (
        <div>
            {showSelection && (
                <ProcessorSelectorGrid
                    selected={selectedMethod}
                    onSelect={setSelectedMethod}
                    processors={configuredProcessors}
                />
            )}

            {/* Render the selected payment method */}
            {selectedMethod === 'stripe' && props.intent && props.stripe ? (
                <div>
                    <Elements stripe={props.stripe} options={stripeOptions} key={props.intent.id}>
                        <PaymentButton
                            selectedNode={props.selectedNode}
                            product={props.product}
                            vars={props.vars}
                            intent={props.intent}
                            couponId={props.couponId}
                            billingDays={props.billingDays}
                            selectedEggId={props.selectedEggId}
                            serverName={props.serverName}
                            domainPayload={props.domainPayload}
                        />
                    </Elements>
                </div>
            ) : selectedMethod === 'paypal' ? (
                <div>
                    <PayPalPaymentButton
                        selectedNode={props.selectedNode}
                        product={props.product}
                        vars={props.vars}
                        couponId={props.couponId}
                        billingDays={props.billingDays}
                        selectedEggId={props.selectedEggId}
                        serverName={props.serverName}
                        domainPayload={props.domainPayload}
                    />
                </div>
            ) : null}
        </div>
    );
};
