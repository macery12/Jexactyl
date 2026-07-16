import { FormEvent, useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Product, StripeIntent } from '@definitions/account/billing';
import { updateStripeIntent } from '@/api/routes/account/billing/orders/stripe';

interface Props {
    selectedNode?: number;
    product: Product;
    vars: Map<string, string>;
    intent: StripeIntent;
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

export default (data: Props) => {
    const stripe = useStripe();
    const elements = useElements();
    const [loading, setLoading] = useState(false);
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const handleSubmit = async (event: FormEvent) => {
        clearFlashes();
        setLoading(true);
        event.preventDefault();

        if (!stripe || !elements || !data.product || !data.selectedNode) return;

        const variables = Array.from(data.vars, ([key, value]) => ({ key, value }));

        await updateStripeIntent({
            id: Number(data.product.id),
            intent: data.intent.id,
            node_id: data.selectedNode!,
            vars: variables,
            coupon_id: data.couponId,
            egg_id: data.selectedEggId,
            name: data.serverName,
            domain_payload: data.domainPayload,
            billing_days: data.billingDays,
        })
            .then(() => {
                stripe.confirmPayment({
                    elements,
                    confirmParams: {
                        return_url: window.location.origin + '/account/billing/processing',
                    },
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'account:billing:order', error }));
    };

    return (
        <form onSubmit={handleSubmit}>
            <PaymentElement />
            <SpinnerOverlay visible={loading} />
            <FlashMessageRender byKey={'store:order'} className={'mb-4'} />
            <Button
                disabled={!data.selectedNode || !data.serverName.trim()}
                className={'mt-4 w-full'}
                size={Button.Sizes.Large}
            >
                Pay Now
            </Button>
        </form>
    );
};
