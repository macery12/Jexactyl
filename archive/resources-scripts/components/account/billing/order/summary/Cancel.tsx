import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useStoreState } from '@/state/hooks';
import CancelSvg from '@/assets/images/themed/CancelSvg';
import PageContentBlock from '@/elements/PageContentBlock';
import http from '@/api/http';

export default () => {
    const { colors } = useStoreState(s => s.theme.data!);
    const { search } = useLocation();

    useEffect(() => {
        // PayPal passes the Order ID as `token` on the cancel redirect URL.
        // Mark the order as failed so it doesn't remain "pending".
        const params = new URLSearchParams(search);
        const token = params.get('token');
        if (token) {
            http.post('/api/client/billing/paypal/cancel', { order_id: token }).catch(() => {
                // Silently ignore – the order will expire on PayPal's side eventually.
            });
        }
    }, []);

    return (
        <PageContentBlock>
            <div className={'flex justify-center'}>
                <div
                    className={'relative w-full rounded-lg p-12 text-center shadow-lg sm:w-3/4 md:w-1/2 md:p-20'}
                    style={{ backgroundColor: colors.secondary }}
                >
                    <CancelSvg color={colors.primary} />
                    <h2 className={'mt-10 text-4xl font-bold text-white'}>Order Cancelled</h2>
                    <p className={'mt-2 text-sm text-neutral-400'}>
                        Your order was cancelled due to payment not being completed. You have not been charged. If
                        you&apos;d like to retry this order, please click &apos;Order&apos; above.
                    </p>
                </div>
            </div>
        </PageContentBlock>
    );
};
