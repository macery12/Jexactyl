import React from 'react';
import { Order as AccountOrder } from '@definitions/account/billing/models';
import { Order as AdminOrder } from '@definitions/admin/models';
import tw from 'twin.macro';
import CopyOnClick from '@/elements/CopyOnClick';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExternalLinkAlt, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { formatDistanceToNowStrict, format } from 'date-fns';
import PaymentProcessorBadge from '@/components/elements/PaymentProcessorBadge';
import { useStoreState } from '@/state/hooks';

interface Props {
    order: AccountOrder | AdminOrder;
}

const OrderInspectorPaymentTab: React.FC<Props> = ({ order }) => {
    const { colors } = useStoreState(state => state.theme.data!);
    const tx = order.transaction;

    const getProviderDashboardUrl = (): string | null => {
        if (!tx?.external_id) return null;
        switch (order.payment_processor) {
            case 'stripe':
                return `https://dashboard.stripe.com/payments/${tx.external_id}`;
            case 'paypal':
                return `https://www.paypal.com/activity/payment/${tx.external_id}`;
            default:
                return null;
        }
    };

    const providerUrl = getProviderDashboardUrl();

    const truncate = (str: string, max = 32) => (str.length > max ? `${str.substring(0, max)}…` : str);

    return (
        <div css={tw`space-y-6`}>
            {/* Provider Information */}
            <div>
                <h3 css={tw`text-lg font-semibold text-white mb-4`}>Payment Provider</h3>
                <div css={tw`rounded-lg p-4 space-y-3`} style={{ backgroundColor: colors.secondary }}>
                    <div css={tw`flex justify-between items-center`}>
                        <span css={tw`text-sm text-gray-400`}>Provider</span>
                        <PaymentProcessorBadge processor={order.payment_processor} size="medium" />
                    </div>
                    {providerUrl && (
                        <div css={tw`pt-3 border-t border-neutral-800`}>
                            <a
                                href={providerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                css={tw`inline-flex items-center gap-2 text-sm transition-opacity hover:opacity-80`}
                                style={{ color: colors.primary }}
                            >
                                <FontAwesomeIcon icon={faExternalLinkAlt} />
                                View in{' '}
                                {order.payment_processor.charAt(0).toUpperCase() +
                                    order.payment_processor.slice(1)}{' '}
                                Dashboard
                            </a>
                        </div>
                    )}
                </div>
            </div>

            {/* Transaction Details */}
            <div>
                <h3 css={tw`text-lg font-semibold text-white mb-4`}>Transaction Details</h3>
                <div css={tw`rounded-lg p-4`} style={{ backgroundColor: colors.secondary }}>
                    {order.payment_processor === 'free' ? (
                        <div css={tw`space-y-3`}>
                            <div css={tw`flex justify-between items-start`}>
                                <span css={tw`text-sm text-gray-400`}>Payment</span>
                                <span css={tw`text-sm text-white`}>No payment required ($0.00)</span>
                            </div>
                            {tx?.external_id && (
                                <div css={tw`flex justify-between items-start`}>
                                    <span css={tw`text-sm text-gray-400`}>Reference</span>
                                    <CopyOnClick text={tx.external_id}>
                                        <code
                                            css={tw`text-sm font-mono text-white px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity`}
                                            style={{ backgroundColor: colors.background || colors.secondary }}
                                        >
                                            {truncate(tx.external_id)}
                                        </code>
                                    </CopyOnClick>
                                </div>
                            )}
                        </div>
                    ) : tx ? (
                        <div css={tw`space-y-3`}>
                            {/* External ID */}
                            <div css={tw`flex justify-between items-start`}>
                                <span css={tw`text-sm text-gray-400`}>Transaction ID</span>
                                <CopyOnClick text={tx.external_id}>
                                    <code
                                        css={tw`text-sm font-mono text-white px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity`}
                                        style={{ backgroundColor: colors.background || colors.secondary }}
                                    >
                                        {truncate(tx.external_id)}
                                    </code>
                                </CopyOnClick>
                            </div>
                            {/* Capture ID */}
                            {tx.capture_id && (
                                <div css={tw`flex justify-between items-start`}>
                                    <span css={tw`text-sm text-gray-400`}>Capture ID</span>
                                    <CopyOnClick text={tx.capture_id}>
                                        <code
                                            css={tw`text-sm font-mono text-white px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity`}
                                            style={{ backgroundColor: colors.background || colors.secondary }}
                                        >
                                            {truncate(tx.capture_id)}
                                        </code>
                                    </CopyOnClick>
                                </div>
                            )}
                            {/* Processor status */}
                            {tx.status && (
                                <div css={tw`flex justify-between items-start`}>
                                    <span css={tw`text-sm text-gray-400`}>Processor Status</span>
                                    <span css={tw`text-sm text-white capitalize`}>{tx.status}</span>
                                </div>
                            )}
                            {/* Amount + currency */}
                            <div css={tw`flex justify-between items-start border-t border-neutral-800 pt-3 mt-3`}>
                                <span css={tw`text-sm text-gray-400`}>Charged Amount</span>
                                <span css={tw`text-sm text-white font-bold`}>
                                    {tx.currency?.toUpperCase()} {Number(tx.amount).toFixed(2)}
                                </span>
                            </div>
                            {/* Payer ID */}
                            {tx.payer_id && (
                                <div css={tw`flex justify-between items-start`}>
                                    <span css={tw`text-sm text-gray-400`}>Payer ID</span>
                                    <CopyOnClick text={tx.payer_id}>
                                        <code
                                            css={tw`text-sm font-mono text-white px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity`}
                                            style={{ backgroundColor: colors.background || colors.secondary }}
                                        >
                                            {truncate(tx.payer_id)}
                                        </code>
                                    </CopyOnClick>
                                </div>
                            )}
                            {/* Payer email */}
                            {tx.payer_email && (
                                <div css={tw`flex justify-between items-start`}>
                                    <span css={tw`text-sm text-gray-400`}>Payer Email</span>
                                    <span css={tw`text-sm text-white`}>{tx.payer_email}</span>
                                </div>
                            )}
                            {/* Captured at */}
                            {tx.captured_at && (
                                <div css={tw`flex justify-between items-start`}>
                                    <span css={tw`text-sm text-gray-400`}>Captured</span>
                                    <div css={tw`text-right`}>
                                        <div css={tw`text-sm text-white`}>
                                            {format(tx.captured_at, 'MMM dd, yyyy HH:mm:ss')}
                                        </div>
                                        <div css={tw`text-xs text-gray-500`}>
                                            {formatDistanceToNowStrict(tx.captured_at, { addSuffix: true })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div css={tw`flex items-center gap-3 text-gray-400 text-sm`}>
                            <FontAwesomeIcon icon={faInfoCircle} />
                            <span>No transaction record found for this order.</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Status Summary */}
            <div>
                <h3 css={tw`text-lg font-semibold text-white mb-4`}>Status Summary</h3>
                <div css={tw`rounded-lg p-4 space-y-3`} style={{ backgroundColor: colors.secondary }}>
                    <div css={tw`flex justify-between items-start`}>
                        <span css={tw`text-sm text-gray-400`}>Order Status</span>
                        <span css={tw`text-sm text-white capitalize font-medium`}>{order.status}</span>
                    </div>
                    <div css={tw`flex justify-between items-start`}>
                        <span css={tw`text-sm text-gray-400`}>Order Total</span>
                        <span css={tw`text-sm text-white font-bold`}>${order.total.toFixed(2)}</span>
                    </div>
                    <div css={tw`pt-3 border-t border-neutral-800 text-xs text-gray-500`}>
                        <p>
                            <strong>Status:</strong>{' '}
                            {order.status === 'processed'
                                ? 'Payment successfully processed and order completed.'
                                : order.status === 'pending'
                                  ? 'Payment is pending confirmation from the provider.'
                                  : order.status === 'failed'
                                    ? 'Payment failed or was declined by the provider.'
                                    : order.status === 'cancelled'
                                      ? 'Payment was cancelled by the customer.'
                                      : 'Order has expired or reached an unknown state.'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderInspectorPaymentTab;
