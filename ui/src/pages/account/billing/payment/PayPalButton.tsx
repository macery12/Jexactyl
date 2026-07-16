import { m } from '@/i18n';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { createPayPalOrder, updatePayPalOrder } from '@/api/accountBilling';

export interface PayPalButtonProps {
    productId: number;
    nodeId: number;
    vars: { key: string; value: string }[];
    couponId?: number;
    eggId?: number;
    serverName: string;
    billingDays: number;
}

// PayPal redirect flow (no SDK): create + populate the order, then bounce
// through the backend redirect endpoint to PayPal's approval page. PayPal
// returns the user to /v2/account/billing/processing?processor=paypal.
export default function PayPalButton(props: PayPalButtonProps) {
    const push = useFlashes(s => s.push);
    const [loading, setLoading] = useState(false);

    const handleClick = async () => {
        if (!props.nodeId) return;
        setLoading(true);
        try {
            const returnUrl = window.location.origin + '/v2/account/billing/processing?processor=paypal';
            const cancelUrl = window.location.origin + '/v2/account/billing/cancel';
            const order = await createPayPalOrder(props.productId, props.couponId, props.billingDays, returnUrl, cancelUrl);
            await updatePayPalOrder({
                productId: props.productId,
                orderId: order.id,
                nodeId: props.nodeId,
                vars: props.vars,
                couponId: props.couponId,
                eggId: props.eggId,
                billingDays: props.billingDays,
                name: props.serverName,
            });
            window.location.href = `/api/client/billing/paypal/orders/${order.id}/redirect`;
        } catch {
            push({ type: 'error', message: m['billing.payment.startPaypalError']() });
            setLoading(false);
        }
    };

    return (
        <Button
            size="lg"
            className="w-full"
            disabled={loading || !props.serverName.trim()}
            onClick={handleClick}
        >
            {loading ? <Spinner className="h-5 w-5" /> : m['billing.payment.payWithPaypal']()}
        </Button>
    );
}
