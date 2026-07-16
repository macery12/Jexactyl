import { FormEvent, useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { updateStripeIntent } from '@/api/routes/account/billing/orders/stripe';

export default ({
    id,
    serverId,
    serverUuid,
    intent,
    renewal,
    billingDays,
}: {
    id?: number;
    serverId: number;
    serverUuid?: string;
    intent: string;
    renewal?: boolean;
    billingDays?: number;
}) => {
    const stripe = useStripe();
    const elements = useElements();
    const { clearFlashes } = useFlash();

    const [loading, setLoading] = useState<boolean>(false);

    const handleSubmit = async (event: FormEvent) => {
        clearFlashes();
        setLoading(true);
        event.preventDefault();

        if (!stripe || !elements) return;

        updateStripeIntent({ id: id!, intent, serverId, renewal, billing_days: billingDays }).then(() => {
            // Build return URL with renewal flag and server UUID for renewals
            let returnUrl = window.location.origin + '/account/billing/processing';
            if (renewal && serverUuid) {
                returnUrl += `?renewal=true&server_uuid=${serverUuid}`;
            }

            stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: returnUrl,
                },
            });
        });
    };

    return (
        <form onSubmit={handleSubmit}>
            <SpinnerOverlay visible={loading} />
            <PaymentElement />
            <div className={'text-right'}>
                <Button className={'mt-4'} size={Button.Sizes.Large}>
                    Pay Now
                </Button>
            </div>
        </form>
    );
};
