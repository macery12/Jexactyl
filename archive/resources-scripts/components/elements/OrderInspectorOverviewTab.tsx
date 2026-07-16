import React from 'react';
import { Order as AccountOrder } from '@definitions/account/billing/models';
import { Order as AdminOrder } from '@definitions/admin/models';
import tw from 'twin.macro';
import { formatDistanceToNowStrict, format } from 'date-fns';
import CopyOnClick from '@/elements/CopyOnClick';
import Pill from '@/elements/Pill';
import { useStoreState } from '@/state/hooks';

interface Props {
    order: AccountOrder | AdminOrder;
    isAdmin?: boolean;
}

const OrderInspectorOverviewTab: React.FC<Props> = ({ order, isAdmin = false }) => {
    const { colors } = useStoreState(state => state.theme.data!);

    const getOrderTypeName = (type: string) => {
        switch (type) {
            case 'new':
                return 'New Purchase';
            case 'ren':
                return 'Renewal';
            case 'upg':
                return 'Upgrade';
            default:
                return type.toUpperCase();
        }
    };

    const getOrderTypeColor = (type: string) => {
        switch (type) {
            case 'new':
                return 'success';
            case 'ren':
                return 'info';
            case 'upg':
                return 'warn';
            default:
                return 'unknown';
        }
    };

    return (
        <div css={tw`space-y-6`}>
            {/* Order Information */}
            <div>
                <h3 css={tw`text-lg font-semibold text-white mb-4`}>Order Information</h3>
                <div css={tw`rounded-lg p-4 space-y-3`} style={{ backgroundColor: colors.secondary }}>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Order ID</span>
                        <CopyOnClick text={order.id.toString()}>
                            <code
                                css={tw`text-sm font-mono text-white bg-neutral-800 px-2 py-1 rounded cursor-pointer hover:bg-neutral-700 transition-colors`}
                                style={{ backgroundColor: colors.background || colors.secondary }}
                            >
                                {order.id}
                            </code>
                        </CopyOnClick>
                    </div>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Order Name</span>
                        <span css={tw`text-sm text-white font-medium`}>{order.name}</span>
                    </div>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Order Type</span>
                        <Pill size="small" type={getOrderTypeColor(order.type)}>
                            {getOrderTypeName(order.type)}
                        </Pill>
                    </div>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Status</span>
                        <span css={tw`text-sm text-white capitalize`}>{order.status}</span>
                    </div>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Created</span>
                        <div css={tw`text-right`}>
                            <div css={tw`text-sm text-white`}>{format(order.created_at, 'MMM dd, yyyy HH:mm:ss')}</div>
                            <div css={tw`text-xs text-gray-500`}>
                                {formatDistanceToNowStrict(order.created_at, { addSuffix: true })}
                            </div>
                        </div>
                    </div>
                    {order.updated_at && (
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>Last Updated</span>
                            <div css={tw`text-right`}>
                                <div css={tw`text-sm text-white`}>
                                    {format(order.updated_at, 'MMM dd, yyyy HH:mm:ss')}
                                </div>
                                <div css={tw`text-xs text-gray-500`}>
                                    {formatDistanceToNowStrict(order.updated_at, { addSuffix: true })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Product & Billing */}
            <div>
                <h3 css={tw`text-lg font-semibold text-white mb-4`}>Product & Billing</h3>
                <div css={tw`rounded-lg p-4 space-y-3`} style={{ backgroundColor: colors.secondary }}>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Plan / Product</span>
                        <span css={tw`text-sm text-white font-medium`}>
                            {'product_name' in order && order.product_name ? (
                                order.product_name
                            ) : (
                                <span css={tw`text-gray-500`}>Unknown (#{order.product_id})</span>
                            )}
                        </span>
                    </div>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Description</span>
                        <span css={tw`text-sm text-white max-w-md text-right`}>{order.description}</span>
                    </div>
                    <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                        <span css={tw`text-sm text-gray-400`}>Product ID</span>
                        <code css={tw`text-sm font-mono text-gray-300`}>{order.product_id}</code>
                    </div>
                    {order.egg_id && (
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>Egg ID</span>
                            <code css={tw`text-sm font-mono text-gray-300`}>{order.egg_id}</code>
                        </div>
                    )}
                    {order.billing_days && (
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>Billing Period</span>
                            <span css={tw`text-sm text-white`}>{order.billing_days} days</span>
                        </div>
                    )}
                    {order.subtotal != null && (
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>Subtotal</span>
                            <span css={tw`text-sm text-white`}>${Number(order.subtotal).toFixed(2)}</span>
                        </div>
                    )}
                    {order.discount != null && order.discount > 0 && (
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>Discount</span>
                            <span css={tw`text-sm text-green-400`}>-${Number(order.discount).toFixed(2)}</span>
                        </div>
                    )}
                    {order.coupon_id != null && (
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>Coupon ID</span>
                            <code css={tw`text-sm font-mono text-gray-300`}>{order.coupon_id}</code>
                        </div>
                    )}
                    <div
                        css={tw`flex flex-wrap justify-between items-start gap-1 border-t border-neutral-800 pt-3 mt-3`}
                    >
                        <span css={tw`text-sm text-gray-400 font-medium`}>Total Amount</span>
                        <span css={tw`text-lg text-white font-bold flex items-center gap-2`}>
                            ${order.total.toFixed(2)}
                            {order.type === 'ren' && <span css={tw`text-sm text-gray-400`}>/mo</span>}
                            {(order.total === 0 || order.payment_processor === 'free') && (
                                <Pill size="small" type="success">
                                    Free
                                </Pill>
                            )}
                        </span>
                    </div>
                </div>
            </div>

            {/* Server Information */}
            {(order.server_name || order.server_id) && (
                <div>
                    <h3 css={tw`text-lg font-semibold text-white mb-4`}>Server Information</h3>
                    <div css={tw`rounded-lg p-4 space-y-3`} style={{ backgroundColor: colors.secondary }}>
                        {order.server_name && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Server Name</span>
                                <span css={tw`text-sm text-white font-medium`}>{order.server_name}</span>
                            </div>
                        )}
                        {order.server_uuid && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Server UUID</span>
                                <CopyOnClick text={order.server_uuid}>
                                    <code
                                        css={tw`text-sm font-mono text-white px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity`}
                                        style={{ backgroundColor: colors.background || colors.secondary }}
                                    >
                                        {order.server_uuid}
                                    </code>
                                </CopyOnClick>
                            </div>
                        )}
                        {order.server_id && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Server ID</span>
                                <code css={tw`text-sm font-mono text-gray-300`}>{order.server_id}</code>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Customer Information (Admin only) */}
            {isAdmin && 'user_id' in order && (
                <div>
                    <h3 css={tw`text-lg font-semibold text-white mb-4`}>Customer Information</h3>
                    <div css={tw`rounded-lg p-4 space-y-3`} style={{ backgroundColor: colors.secondary }}>
                        {'username' in order && order.username && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Username</span>
                                <span css={tw`text-sm text-white font-medium`}>{order.username}</span>
                            </div>
                        )}
                        {'user_email' in order && order.user_email && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Email</span>
                                <span css={tw`text-sm text-white`}>{order.user_email}</span>
                            </div>
                        )}
                        <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                            <span css={tw`text-sm text-gray-400`}>User ID</span>
                            <code css={tw`text-sm font-mono text-gray-300`}>{order.user_id}</code>
                        </div>
                        {'node_id' in order && order.node_id != null && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Node ID</span>
                                <code css={tw`text-sm font-mono text-gray-300`}>{order.node_id}</code>
                            </div>
                        )}
                        {'final_price' in order && order.final_price != null && (
                            <div css={tw`flex flex-wrap justify-between items-start gap-1`}>
                                <span css={tw`text-sm text-gray-400`}>Final Price (internal)</span>
                                <span css={tw`text-sm text-white`}>${Number(order.final_price).toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderInspectorOverviewTab;
