import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { useState, type FormEvent } from 'react';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { updateStripeIntent } from '@/api/accountBilling';

export interface StripeFormProps {
    productId: number;
    intentId: string;
    nodeId: number;
    vars: { key: string; value: string }[];
    couponId?: number;
    eggId?: number;
    serverName: string;
    billingDays: number;
}

// The card form rendered inside <Elements>. Mirrors V1's PaymentButton: persist
// the order details onto the intent, then confirm the payment with a redirect
// to the processing page.
export default function StripeForm(props: StripeFormProps) {
    const stripe = useStripe();
    const elements = useElements();
    const push = useFlashes(s => s.push);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!stripe || !elements || !props.nodeId) return;
        setLoading(true);
        try {
            await updateStripeIntent({
                productId: props.productId,
                intent: props.intentId,
                nodeId: props.nodeId,
                vars: props.vars,
                couponId: props.couponId,
                eggId: props.eggId,
                name: props.serverName,
                billingDays: props.billingDays,
            });
            const { error } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: window.location.origin + abs('/billing/processing'),
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
        <form onSubmit={handleSubmit} className="space-y-4">
            <PaymentElement />
            <Button type="submit" size="lg" className="w-full" disabled={loading || !props.serverName.trim()}>
                {loading ? <Spinner className="h-5 w-5" /> : m['billing.payment.payNow']()}
            </Button>
        </form>
    );
}
