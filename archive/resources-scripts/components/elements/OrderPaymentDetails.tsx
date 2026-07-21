import React from 'react';
import { Order as AccountOrder } from '@definitions/account/billing/models';
import { Order as AdminOrder } from '@definitions/admin/models';
import CopyOnClick from '@/elements/CopyOnClick';
import tw from 'twin.macro';
import { formatDistanceToNowStrict } from 'date-fns';

interface Props {
    order: AccountOrder | AdminOrder;
}

const OrderPaymentDetails: React.FC<Props> = ({ order }) => {
    const renderStripeDetails = () => (
        <div css={tw`space-y-2`}>
            {order.payment_intent_id && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>Payment Intent ID:</span>
                    <div css={tw`mt-1`}>
                        <CopyOnClick text={order.payment_intent_id}>
                            <code css={tw`text-sm font-mono bg-neutral-800 rounded px-2 py-1`}>
                                {order.payment_intent_id}
                            </code>
                        </CopyOnClick>
                    </div>
                </div>
            )}
        </div>
    );

    const renderPayPalDetails = () => (
        <div css={tw`space-y-2`}>
            {order.paypal_order_id && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>PayPal Order ID:</span>
                    <div css={tw`mt-1`}>
                        <CopyOnClick text={order.paypal_order_id}>
                            <code css={tw`text-sm font-mono bg-neutral-800 rounded px-2 py-1`}>
                                {order.paypal_order_id}
                            </code>
                        </CopyOnClick>
                    </div>
                </div>
            )}
            {order.paypal_capture_id && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>Capture ID:</span>
                    <div css={tw`mt-1`}>
                        <CopyOnClick text={order.paypal_capture_id}>
                            <code css={tw`text-sm font-mono bg-neutral-800 rounded px-2 py-1`}>
                                {order.paypal_capture_id}
                            </code>
                        </CopyOnClick>
                    </div>
                </div>
            )}
            {order.paypal_payer_email && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>Payer Email:</span>
                    <div css={tw`mt-1 text-white`}>{order.paypal_payer_email}</div>
                </div>
            )}
            {order.paypal_payer_id && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>Payer ID:</span>
                    <div css={tw`mt-1`}>
                        <CopyOnClick text={order.paypal_payer_id}>
                            <code css={tw`text-sm font-mono bg-neutral-800 rounded px-2 py-1`}>
                                {order.paypal_payer_id}
                            </code>
                        </CopyOnClick>
                    </div>
                </div>
            )}
            {order.paypal_status && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>PayPal Status:</span>
                    <div css={tw`mt-1 text-white`}>{order.paypal_status}</div>
                </div>
            )}
            {order.paypal_amount && order.paypal_currency && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>PayPal Amount:</span>
                    <div css={tw`mt-1 text-white font-bold`}>
                        {order.paypal_currency} {order.paypal_amount.toFixed(2)}
                    </div>
                </div>
            )}
            {order.paypal_captured_at && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>Captured:</span>
                    <div css={tw`mt-1 text-white`}>
                        {formatDistanceToNowStrict(order.paypal_captured_at, { addSuffix: true })}
                    </div>
                </div>
            )}
        </div>
    );

    const renderFreeDetails = () => (
        <div css={tw`space-y-2`}>
            <div>
                <span css={tw`text-sm text-gray-400`}>Payment:</span>
                <div css={tw`mt-1 text-white`}>No payment required ($0.00)</div>
            </div>
            {order.payment_intent_id && (
                <div>
                    <span css={tw`text-sm text-gray-400`}>Reference:</span>
                    <div css={tw`mt-1`}>
                        <CopyOnClick text={order.payment_intent_id}>
                            <code css={tw`text-sm font-mono bg-neutral-800 rounded px-2 py-1`}>
                                {order.payment_intent_id}
                            </code>
                        </CopyOnClick>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div css={tw`mt-2 p-3 bg-neutral-900 rounded`}>
            <div css={tw`text-xs font-semibold text-gray-300 uppercase mb-2`}>Payment Details</div>
            {order.payment_processor === 'stripe' && renderStripeDetails()}
            {order.payment_processor === 'paypal' && renderPayPalDetails()}
            {order.payment_processor === 'free' && renderFreeDetails()}
        </div>
    );
};

export default OrderPaymentDetails;
