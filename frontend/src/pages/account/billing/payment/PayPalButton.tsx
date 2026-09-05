import { m } from '@/i18n/messages';
import { abs } from '@/lib/base';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { createPayPalOrder, type PayPalOrder } from '@/api/accountBilling';

export interface PayPalButtonProps {
    productId: number;
    nodeId?: number;
    vars?: { key: string; value: string }[];
    couponId?: number;
    eggId?: number;
    serverName?: string;
    billingDays?: number;
    checkoutNonce: string;
    planChange?: boolean;
    serverId?: number;
    serverIdentifier?: string;
    preparedOrder?: PayPalOrder;
}

// PayPal redirect flow (no SDK): create the provider order from one complete,
// immutable server-side snapshot, then bounce
// through the backend redirect endpoint to PayPal's approval page. PayPal
// returns the user to the billing processing page?processor=paypal.
export default function PayPalButton(props: PayPalButtonProps) {
    const push = useFlashes(s => s.push);
    const [loading, setLoading] = useState(false);

    const handleClick = async () => {
        if (props.planChange ? !props.serverId || !props.serverIdentifier : !props.nodeId) return;
        setLoading(true);
        try {
            if (props.preparedOrder) {
                window.location.href = `/api/client/billing/paypal/orders/${props.preparedOrder.id}/redirect`;
                return;
            }

            const context = props.planChange
                ? `&plan_change=true&server=${encodeURIComponent(props.serverIdentifier!)}`
                : '';
            const returnUrl = window.location.origin + abs(`/billing/processing?processor=paypal${context}`);
            const cancelUrl = window.location.origin + abs(`/billing/cancel?${context.slice(1)}`);
            const order = await createPayPalOrder(
                props.productId,
                props.couponId,
                props.billingDays,
                returnUrl,
                cancelUrl,
                props.planChange
                    ? {
                          planChange: true,
                          serverId: props.serverId,
                          checkoutNonce: props.checkoutNonce,
                      }
                    : {
                          nodeId: props.nodeId,
                          vars: props.vars,
                          eggId: props.eggId,
                          name: props.serverName,
                          checkoutNonce: props.checkoutNonce,
                      },
            );
            window.location.href = `/api/client/billing/paypal/orders/${order.id}/redirect`;
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['billing.payment.startPaypalError']() });
            setLoading(false);
        }
    };

    return (
        <Button
            size="lg"
            className="w-full"
            disabled={loading || (!props.planChange && !props.serverName?.trim())}
            onClick={handleClick}
        >
            {loading ? <Spinner className="h-5 w-5" /> : m['billing.payment.payWithPaypal']()}
        </Button>
    );
}
