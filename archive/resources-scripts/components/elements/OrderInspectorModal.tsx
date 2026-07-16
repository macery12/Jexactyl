import React, { useState } from 'react';
import { Order as AccountOrder } from '@definitions/account/billing/models';
import { Order as AdminOrder } from '@definitions/admin/models';
import tw from 'twin.macro';
import { Dialog } from '@headlessui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import Pill from '@/elements/Pill';
import PaymentProcessorBadge from '@/components/elements/PaymentProcessorBadge';
import OrderInspectorOverviewTab from './OrderInspectorOverviewTab';
import OrderInspectorPaymentTab from './OrderInspectorPaymentTab';
import OrderInspectorTimelineTab from './OrderInspectorTimelineTab';
import OrderInspectorThreatTab from './OrderInspectorThreatTab';
import { useStoreState } from '@/state/hooks';

interface Props {
    order: AccountOrder | AdminOrder;
    isOpen: boolean;
    onClose: () => void;
    isAdmin?: boolean;
}

type TabType = 'overview' | 'payment' | 'timeline' | 'threat';

const OrderInspectorModal: React.FC<Props> = ({ order, isOpen, onClose, isAdmin = false }) => {
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const { colors } = useStoreState(state => state.theme.data!);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'processed':
                return 'success';
            case 'failed':
                return 'danger';
            case 'cancelled':
                return 'info';
            case 'pending':
                return 'warn';
            default:
                return 'unknown';
        }
    };

    const getRowAccentColor = (status: string) => {
        switch (status) {
            case 'failed':
                return 'bg-red-500/10 border-l-4 border-red-500';
            case 'cancelled':
                return 'bg-blue-500/10 border-l-4 border-blue-500';
            case 'pending':
                return 'bg-yellow-500/10 border-l-4 border-yellow-500';
            case 'processed':
                return 'bg-green-500/10 border-l-4 border-green-500';
            default:
                return '';
        }
    };

    const getThreatIndexColor = () => {
        if (!('threat_index' in order)) return 'unknown';
        if (order.threat_index >= 50) return 'danger';
        if (order.threat_index >= 25) return 'warn';
        return 'success';
    };

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-50">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/70" aria-hidden="true" />

            {/* Full-screen container */}
            <div className="fixed inset-0 flex items-center justify-center p-4">
                <Dialog.Panel
                    css={tw`rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col`}
                    style={{ backgroundColor: colors.background || colors.secondary }}
                >
                    {/* Header */}
                    <div className={`p-6 border-b border-neutral-700 ${getRowAccentColor(order.status)}`}>
                        <div css={tw`flex items-start justify-between`}>
                            <div css={tw`flex-1`}>
                                <div css={tw`flex items-center gap-3 mb-2`}>
                                    <h2 css={tw`text-2xl font-bold text-white`}>
                                        {order.server_name || order.name} | #{order.id}
                                    </h2>
                                    {'threat_index' in order && order.threat_index >= 0 && (
                                        <Pill size="small" type={getThreatIndexColor()}>
                                            <FontAwesomeIcon icon={faExclamationTriangle} className="mr-1" />
                                            Threat: {order.threat_index}/100
                                        </Pill>
                                    )}
                                </div>
                                <div css={tw`text-lg text-gray-300 mb-3`}>
                                    {'product_name' in order && order.product_name
                                        ? order.product_name
                                        : 'Unknown Product'}{' '}
                                    — ${order.total.toFixed(2)}
                                    {order.type === 'ren' && '/mo'}
                                </div>
                                <div css={tw`flex items-center gap-3 flex-wrap`}>
                                    <div css={tw`flex items-center gap-2`}>
                                        <span css={tw`text-sm text-gray-400`}>Status:</span>
                                        <Pill size="small" type={getStatusColor(order.status)}>
                                            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                                        </Pill>
                                    </div>
                                    <div css={tw`flex items-center gap-2`}>
                                        <span css={tw`text-sm text-gray-400`}>Provider:</span>
                                        <PaymentProcessorBadge processor={order.payment_processor} size="small" />
                                    </div>
                                </div>
                            </div>
                            <button onClick={onClose} css={tw`text-gray-400 hover:text-white transition-colors p-2`}>
                                <FontAwesomeIcon icon={faTimes} size="lg" />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div css={tw`border-b border-neutral-700`} style={{ backgroundColor: colors.secondary }}>
                        <div css={tw`flex gap-1 px-6`}>
                            <button
                                onClick={() => setActiveTab('overview')}
                                className={'px-4 py-3 text-sm font-medium transition-colors border-b-2'}
                                style={
                                    activeTab === 'overview'
                                        ? { borderBottomColor: colors.primary, color: '#fff' }
                                        : { borderBottomColor: 'transparent', color: '#9ca3af' }
                                }
                            >
                                Overview
                            </button>
                            <button
                                onClick={() => setActiveTab('payment')}
                                className={'px-4 py-3 text-sm font-medium transition-colors border-b-2'}
                                style={
                                    activeTab === 'payment'
                                        ? { borderBottomColor: colors.primary, color: '#fff' }
                                        : { borderBottomColor: 'transparent', color: '#9ca3af' }
                                }
                            >
                                Payment
                            </button>
                            <button
                                onClick={() => setActiveTab('timeline')}
                                className={'px-4 py-3 text-sm font-medium transition-colors border-b-2'}
                                style={
                                    activeTab === 'timeline'
                                        ? { borderBottomColor: colors.primary, color: '#fff' }
                                        : { borderBottomColor: 'transparent', color: '#9ca3af' }
                                }
                            >
                                Timeline
                            </button>
                            {isAdmin && 'threat_index' in order && (
                                <button
                                    onClick={() => setActiveTab('threat')}
                                    className={'px-4 py-3 text-sm font-medium transition-colors border-b-2'}
                                    style={
                                        activeTab === 'threat'
                                            ? { borderBottomColor: colors.primary, color: '#fff' }
                                            : { borderBottomColor: 'transparent', color: '#9ca3af' }
                                    }
                                >
                                    Threat Analysis
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tab Content */}
                    <div css={tw`flex-1 overflow-y-auto p-6`}>
                        {activeTab === 'overview' && <OrderInspectorOverviewTab order={order} isAdmin={isAdmin} />}
                        {activeTab === 'payment' && <OrderInspectorPaymentTab order={order} />}
                        {activeTab === 'timeline' && <OrderInspectorTimelineTab order={order} />}
                        {activeTab === 'threat' && isAdmin && 'threat_index' in order && (
                            <OrderInspectorThreatTab order={order} />
                        )}
                    </div>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
};

export default OrderInspectorModal;
