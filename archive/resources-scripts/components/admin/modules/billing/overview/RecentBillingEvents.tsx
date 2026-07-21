import { useStoreState } from '@/state/hooks';
import ContentBox from '@/elements/ContentBox';
import { BillingAnalytics, BillingEvent } from '@definitions/admin';
import { format, parseISO } from 'date-fns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faTimesCircle, faUndo, faShoppingCart } from '@fortawesome/free-solid-svg-icons';
import { faCcStripe, faCcPaypal } from '@fortawesome/free-brands-svg-icons';
import { faCircle } from '@fortawesome/free-solid-svg-icons';
import { useNavigate } from 'react-router-dom';

interface RecentBillingEventsProps {
    data: BillingAnalytics;
}

export default ({ data }: RecentBillingEventsProps) => {
    const navigate = useNavigate();
    const settings = useStoreState(s => s.everest.data!.billing);
    const currencySymbol = settings.currency.symbol;

    const events = data.recentEvents || [];

    const getEventIcon = (status: string) => {
        if (status === 'processed') return { icon: faCheckCircle, color: 'text-green-500' };
        if (status === 'failed') return { icon: faTimesCircle, color: 'text-red-500' };
        if (status === 'cancelled') return { icon: faTimesCircle, color: 'text-blue-400' };
        if (status === 'refunded') return { icon: faUndo, color: 'text-yellow-500' };
        return { icon: faShoppingCart, color: 'text-gray-500' };
    };

    const getEventTypeLabel = (type: string) => {
        switch (type) {
            case 'new':
                return 'New Purchase';
            case 'ren':
                return 'Renewal';
            case 'upg':
                return 'Upgrade';
            default:
                return type;
        }
    };

    const getEventStatusLabel = (status: string) => {
        switch (status) {
            case 'processed':
                return 'Payment Succeeded';
            case 'failed':
                return 'Payment Failed';
            case 'cancelled':
                return 'Order Cancelled';
            case 'pending':
                return 'Pending';
            case 'expired':
                return 'Expired';
            default:
                return status;
        }
    };

    const getProviderIcon = (processor: string) => {
        switch (processor?.toLowerCase()) {
            case 'stripe':
                return faCcStripe;
            case 'paypal':
                return faCcPaypal;
            case 'free':
                return faCheckCircle;
            default:
                return faCircle;
        }
    };

    const handleRowClick = (event: BillingEvent) => {
        // Deep link to order or server detail page
        if (event.server_uuid) {
            navigate(`/admin/servers/${event.server_uuid}`);
        } else {
            navigate(`/admin/billing/orders`);
        }
    };

    return (
        <ContentBox title="Recent Billing Events" className="mt-6">
            {events.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                                    Date
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                                    Event Type
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                                    Provider
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-400">
                                    Amount
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                                    Reference
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map(event => {
                                const eventIcon = getEventIcon(event.status);
                                return (
                                    <tr
                                        key={event.id}
                                        onClick={() => handleRowClick(event)}
                                        className="cursor-pointer border-b border-gray-800 transition-colors hover:bg-gray-800/50"
                                    >
                                        <td className="px-4 py-3 text-sm text-gray-300">
                                            {format(
                                                typeof event.date === 'string' ? parseISO(event.date) : event.date,
                                                'MMM dd, yyyy HH:mm',
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <FontAwesomeIcon icon={eventIcon.icon} className={eventIcon.color} />
                                                <div>
                                                    <div className="text-sm text-gray-300">
                                                        {getEventTypeLabel(event.type)}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {getEventStatusLabel(event.status)}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <FontAwesomeIcon
                                                    icon={getProviderIcon(event.payment_processor)}
                                                    className="text-gray-400"
                                                />
                                                <span className="text-sm capitalize text-gray-400">
                                                    {event.payment_processor}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-300">
                                            {currencySymbol}
                                            {event.total.toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-400">
                                            <div>
                                                <div>Order #{event.id}</div>
                                                {event.server_name && (
                                                    <div className="text-xs text-gray-500">{event.server_name}</div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="py-12 text-center">
                    <FontAwesomeIcon icon={faShoppingCart} className="mb-3 text-4xl text-gray-600" />
                    <p className="text-sm text-gray-500">No recent billing events yet.</p>
                </div>
            )}
        </ContentBox>
    );
};
