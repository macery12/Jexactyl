import { useState, type FormEvent } from 'react';
import { abs } from '@/lib/base';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { m } from '@/i18n/messages';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';

// Card form for a renewal. Mirrors V1's server/billing/PaymentForm: stamp the
// renewal context onto the intent, then confirm and let Stripe redirect to the
// processing page, which finalises the order and routes back here.
export default function RenewalStripeForm() {
    const stripe = useStripe();
    const elements = useElements();
    const server = useServer();
    const push = useFlashes(s => s.push);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!stripe || !elements) return;
        setLoading(true);

        try {
            const { error } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: window.location.origin + abs(`/billing/processing?renewal=true&server=${server.id}`),
                },
            });

            if (error) {
                push({ type: 'error', message: error.message ?? m['billing.payment.confirmError']() });
                setLoading(false);
            }
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['billing.payment.startCardError']() });
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <PaymentElement />
            <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Spinner className="h-4 w-4" /> : m['billing.payment.payNow']()}
            </Button>
        </form>
    );
}
