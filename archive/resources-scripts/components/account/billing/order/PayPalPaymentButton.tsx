import { FormEvent, useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Product } from '@definitions/account/billing';
import { createPayPalOrder, updatePayPalOrder } from '@/api/routes/account/billing/orders/paypal';

interface Props {
    selectedNode?: number;
    product: Product;
    vars: Map<string, string>;
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
    const [loading, setLoading] = useState(false);
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const handleSubmit = async (event: FormEvent) => {
        console.log('[PayPal] Form submit initiated');
        clearFlashes();
        setLoading(true);
        event.preventDefault();

        console.log('[PayPal] Validating inputs:', {
            product: data.product?.id,
            selectedNode: data.selectedNode,
            serverName: data.serverName,
        });

        if (!data.product || !data.selectedNode) {
            console.warn('[PayPal] Validation failed: missing product or node');
            setLoading(false);
            return;
        }

        const returnUrl = window.location.origin + '/account/billing/processing?processor=paypal';
        console.log('[PayPal] Return URL:', returnUrl);

        try {
            // Create PayPal order with return URL
            console.log('[PayPal] Step 1: Creating PayPal order...');
            const order = await createPayPalOrder(Number(data.product.id), data.couponId, data.billingDays, returnUrl);
            console.log('[PayPal] Order created:', order);

            // Update order with order details
            const variables = Array.from(data.vars, ([key, value]) => ({ key, value }));
            console.log('[PayPal] Step 2: Updating order with details...', {
                orderId: order.id,
                nodeId: data.selectedNode,
                serverName: data.serverName,
            });
            await updatePayPalOrder({
                id: Number(data.product.id),
                orderId: order.id,
                nodeId: data.selectedNode!,
                vars: variables,
                couponId: data.couponId,
                eggId: data.selectedEggId,
                billingDays: data.billingDays,
                name: data.serverName,
                domainPayload: data.domainPayload,
            });
            console.log('[PayPal] Order updated successfully');

            // Redirect to PayPal approval page
            // After approval, PayPal will redirect back to return_url with token parameter
            console.log('[PayPal] Redirecting via backend to approval URL:', order.id);
            window.location.href = `/api/client/billing/paypal/orders/${order.id}/redirect`;
        } catch (error) {
            console.error('[PayPal] Error during checkout:', error);
            clearAndAddHttpError({ key: 'store:order', error });
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <SpinnerOverlay visible={loading} />
            <FlashMessageRender byKey={'store:order'} className={'mb-4'} />
            <Button
                type={'submit'}
                disabled={!data.selectedNode || !data.serverName.trim()}
                className={'mt-4 w-full'}
                size={Button.Sizes.Large}
            >
                Pay with PayPal
            </Button>
        </form>
    );
};
