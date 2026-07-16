import { FormEvent, useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { createPayPalOrder } from '@/api/routes/account/billing/orders/paypal';

export default ({
    id,
    serverId,
    serverUuid,
    couponId,
}: {
    id?: number;
    serverId: number;
    serverUuid?: string;
    couponId?: number;
}) => {
    const [loading, setLoading] = useState<boolean>(false);
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const handleSubmit = async (event: FormEvent) => {
        clearFlashes('suspended:billing');
        setLoading(true);
        event.preventDefault();

        if (!id) return;

        const returnUrl =
            window.location.origin +
            `/account/billing/processing?renewal=true&server_uuid=${serverUuid}&processor=paypal`;

        try {
            // Create PayPal order for renewal with all details in one request
            const order = await createPayPalOrder(id, couponId, undefined, returnUrl, serverId, true);

            // Redirect to PayPal checkout
            // After payment, PayPal will redirect back to return_url with token parameter
            window.location.href = `/api/client/billing/paypal/orders/${order.id}/redirect`;
        } catch (error) {
            clearAndAddHttpError({ key: 'suspended:billing', error });
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <SpinnerOverlay visible={loading} />
            <div className={'text-right'}>
                <Button className={'mt-4'} size={Button.Sizes.Large}>
                    Pay with PayPal
                </Button>
            </div>
        </form>
    );
};
