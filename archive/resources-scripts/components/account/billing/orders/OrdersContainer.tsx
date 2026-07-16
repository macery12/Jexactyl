import Pill, { PillStatus } from '@/elements/Pill';
import PageContentBlock from '@/elements/PageContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { useContext, useEffect, useState, useCallback } from 'react';
import useFlash from '@/plugins/useFlash';
import AdminTable, {
    Loading,
    NoItems,
    Pagination,
    TableBody,
    TableHead,
    TableHeader,
    useTableHooks,
} from '@/elements/AdminTable';
import CopyOnClick from '@/elements/CopyOnClick';
import { formatDistanceToNowStrict } from 'date-fns';
import { useGetOrders } from '@/api/routes/account/billing/orders';
import { Context as OrderContext } from '@/api/routes/account/billing/orders/index';
import { OrderFilters, PaymentProcessor, OrderStatus, OrderType } from '@/api/routes/account/billing/orders/types';
import ScopedAlert from '@/components/account/ScopedAlert';
import PaymentProcessorBadge from '@/components/elements/PaymentProcessorBadge';
import PaymentProcessorFilter from '@/components/elements/PaymentProcessorFilter';
import StatusFilter from '@/components/elements/StatusFilter';
import OrderTypeFilter from '@/components/elements/OrderTypeFilter';
import AmountRangeFilter from '@/components/elements/AmountRangeFilter';
import DateRangeFilter from '@/components/elements/DateRangeFilter';
import OrderInspectorModal from '@/components/elements/OrderInspectorModal';
import { Order } from '@definitions/account/billing/models';
import tw from 'twin.macro';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faFilter, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import Input from '@/elements/Input';
import InputSpinner from '@/elements/InputSpinner';
import debounce from 'debounce';
import { useStoreState } from '@/state/hooks';
import InvoicesTab from './InvoicesTab';

export function format(date: number): string {
    let prefix = 'th';

    switch (date) {
        case 1:
        case 21:
        case 31:
            prefix = 'st';
            break;
        case 2:
        case 22:
            prefix = 'nd';
            break;
        case 3:
        case 23:
            prefix = 'rd';
            break;
        default:
            break;
    }

    return `${date}${prefix}`;
}

export function type(state: string): PillStatus {
    switch (state) {
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
}

function getStatusRowClass(status: string): string {
    switch (status) {
        case 'failed':
            return 'bg-red-500/5 hover:bg-red-500/10';
        case 'cancelled':
            return 'bg-blue-500/5 hover:bg-blue-500/10';
        case 'pending':
            return 'bg-yellow-500/5 hover:bg-yellow-500/10';
        case 'processed':
            return 'bg-green-500/5 hover:bg-green-500/10';
        default:
            return 'hover:bg-neutral-700';
    }
}

function OrderTable() {
    const { data: orders, error } = useGetOrders();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { setPage, setFilters, sort, setSort, sortDirection } = useContext(OrderContext);
    const { colors } = useStoreState(state => state.theme.data!);

    // Filter states
    const [paymentProcessor, setPaymentProcessor] = useState<PaymentProcessor | null>(null);
    const [status, setStatus] = useState<OrderStatus | null>(null);
    const [orderType, setOrderType] = useState<OrderType | null>(null);
    const [minAmount, setMinAmount] = useState<number | null>(null);
    const [maxAmount, setMaxAmount] = useState<number | null>(null);
    const [startDate, setStartDate] = useState<string | null>(null);
    const [endDate, setEndDate] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [searchInputText, setSearchInputText] = useState<string>('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);

    const openInspector = (order: Order) => {
        setSelectedOrder(order);
        setIsInspectorOpen(true);
    };

    const closeInspector = () => {
        setIsInspectorOpen(false);
        setTimeout(() => setSelectedOrder(null), 300);
    };

    const debouncedSearch = useCallback(
        debounce((query: string) => {
            setSearchQuery(query);
            setSearchLoading(false);
        }, 300),
        [],
    );

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSearchInputText(value);
        setSearchLoading(true);
        debouncedSearch(value);
    };

    const buildFilters = (): OrderFilters | null => {
        const filters: OrderFilters = {};
        let hasFilters = false;

        if (paymentProcessor) { filters.payment_processor = paymentProcessor; hasFilters = true; }
        if (status) { filters.status = status; hasFilters = true; }
        if (orderType) { filters.type = orderType; hasFilters = true; }
        if (minAmount !== null) { filters.min_amount = minAmount; hasFilters = true; }
        if (maxAmount !== null) { filters.max_amount = maxAmount; hasFilters = true; }
        if (startDate) { filters.start_date = startDate; hasFilters = true; }
        if (endDate) { filters.end_date = endDate; hasFilters = true; }
        if (searchQuery && searchQuery.length >= 2) { filters.search = searchQuery; hasFilters = true; }

        return hasFilters ? filters : null;
    };

    useEffect(() => {
        setFilters(buildFilters());
    }, [paymentProcessor, status, orderType, minAmount, maxAmount, startDate, endDate, searchQuery]);

    const clearFilters = () => {
        setPaymentProcessor(null);
        setStatus(null);
        setOrderType(null);
        setMinAmount(null);
        setMaxAmount(null);
        setStartDate(null);
        setEndDate(null);
        setSearchQuery('');
        setSearchInputText('');
    };

    const hasActiveFilters =
        paymentProcessor ||
        status ||
        orderType ||
        minAmount !== null ||
        maxAmount !== null ||
        startDate ||
        endDate ||
        searchQuery;

    useEffect(() => {
        clearFlashes();

        if (error) {
            clearAndAddHttpError({ key: 'billing:orders', error });
        }
    }, [error]);

    return (
        <PageContentBlock>
            <ScopedAlert scope="billing" position="top-center" />
            <div className={'mt-8 mb-12 text-3xl font-bold lg:text-5xl'}>
                Billing Activity
                <p className={'mt-1 text-sm font-normal text-gray-400'}>
                    View and manage the active and previous subscriptions you&apos;ve created.
                </p>
                <FlashMessageRender byKey={'billing:orders'} className={'mt-4'} />
            </div>

            {/* Search + Filters card */}
            <div
                className={'rounded-lg shadow-md mb-6'}
                style={{ backgroundColor: colors.background || colors.secondary }}
            >
                <div css={tw`p-4`}>
                    {/* Smart Search Bar */}
                    <div css={tw`flex items-center gap-3 mb-3`}>
                        <div css={tw`flex-1`}>
                            <InputSpinner visible={searchLoading}>
                                <Input
                                    value={searchInputText}
                                    placeholder="Search by order ID, server name, product, or transaction ID…"
                                    onChange={handleSearchChange}
                                    style={{ backgroundColor: colors.secondary }}
                                />
                            </InputSpinner>
                        </div>
                        <button
                            onClick={() => setShowFilters(v => !v)}
                            css={tw`flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap`}
                            style={{
                                backgroundColor: showFilters ? colors.primary : colors.secondary,
                                color: showFilters ? '#fff' : '#9ca3af',
                            }}
                        >
                            <FontAwesomeIcon icon={faFilter} />
                            Filters
                            {hasActiveFilters && (
                                <span css={tw`ml-1 bg-white/20 text-white text-xs rounded-full px-1.5 py-0.5`}>
                                    {
                                        [
                                            paymentProcessor,
                                            status,
                                            orderType,
                                            minAmount,
                                            maxAmount,
                                            startDate,
                                            endDate,
                                            searchQuery,
                                        ].filter(Boolean).length
                                    }
                                </span>
                            )}
                            <FontAwesomeIcon icon={showFilters ? faChevronUp : faChevronDown} css={tw`text-xs`} />
                        </button>
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                css={tw`flex items-center gap-1 text-sm text-red-400 hover:text-red-300 transition-colors`}
                            >
                                <FontAwesomeIcon icon={faTimes} />
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Collapsible Advanced Filters */}
                    {showFilters && (
                        <div css={tw`border-t border-neutral-700 pt-4`}>
                            <div css={tw`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`}>
                                <PaymentProcessorFilter value={paymentProcessor} onChange={setPaymentProcessor} />
                                <StatusFilter value={status} onChange={setStatus} />
                                <OrderTypeFilter value={orderType} onChange={setOrderType} />
                                <AmountRangeFilter
                                    minValue={minAmount}
                                    maxValue={maxAmount}
                                    onMinChange={setMinAmount}
                                    onMaxChange={setMaxAmount}
                                />
                                <DateRangeFilter
                                    startDate={startDate}
                                    endDate={endDate}
                                    onStartDateChange={setStartDate}
                                    onEndDateChange={setEndDate}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <AdminTable>
                <Pagination data={orders} onPageSelect={setPage}>
                    <div className={`overflow-x-auto`}>
                        <table className={`w-full table-auto`}>
                            <TableHead>
                                <TableHeader
                                    name={'Order ID'}
                                    direction={sort === 'id' ? (sortDirection ? 1 : 2) : null}
                                    onClick={() => setSort('id')}
                                />
                                <TableHeader name={'Server'} />
                                <TableHeader name={'Product'} />
                                <TableHeader name={'Type'} />
                                <TableHeader name={'Provider'} />
                                <TableHeader name={'Status'} />
                                <TableHeader
                                    name={'Amount'}
                                    direction={sort === 'total' ? (sortDirection ? 1 : 2) : null}
                                    onClick={() => setSort('total')}
                                />
                                <TableHeader name={'Billing Period'} />
                                <TableHeader
                                    name={'Created'}
                                    direction={sort === 'created_at' ? (sortDirection ? 1 : 2) : null}
                                    onClick={() => setSort('created_at')}
                                />
                            </TableHead>
                            <TableBody>
                                {orders !== undefined &&
                                    orders.items.length > 0 &&
                                    orders.items.map(order => (
                                        <tr
                                            key={order.id}
                                            className={`h-12 cursor-pointer transition-colors ${getStatusRowClass(order.status)}`}
                                            onClick={() => openInspector(order)}
                                        >
                                            <td className={`whitespace-nowrap px-6 py-4 text-left text-sm`}>
                                                <CopyOnClick text={order.id.toString()}>
                                                    <code
                                                        className={`rounded bg-neutral-900 py-1 px-2 font-mono text-gray-300 hover:text-white transition-colors`}
                                                    >
                                                        {order.id}
                                                    </code>
                                                </CopyOnClick>
                                            </td>
                                            {/* Server column */}
                                            <td className={'px-6 py-4'}>
                                                {order.server_name || order.name ? (
                                                    <span css={tw`text-white font-medium`}>
                                                        {order.server_name || order.name}
                                                    </span>
                                                ) : (
                                                    <span css={tw`text-gray-600`}>—</span>
                                                )}
                                            </td>
                                            {/* Product column */}
                                            <td className={'px-6 py-4'}>
                                                {order.product_name ? (
                                                    <span css={tw`text-gray-300`}>{order.product_name}</span>
                                                ) : (
                                                    <span css={tw`text-gray-600`}>—</span>
                                                )}
                                            </td>
                                            <td className={'px-6 py-4 text-gray-300 text-sm'}>
                                                {order.type === 'new' && 'New Purchase'}
                                                {order.type === 'ren' && 'Renewal'}
                                                {order.type === 'upg' && 'Upgrade'}
                                                {!['new', 'ren', 'upg'].includes(order.type) && '—'}
                                            </td>
                                            <td className={'px-6 py-4'}>
                                                <PaymentProcessorBadge
                                                    processor={order.payment_processor}
                                                    size="small"
                                                />
                                            </td>
                                            <td className={'px-6 py-4'}>
                                                <Pill size={'small'} type={type(order.status)}>
                                                    {order.status}
                                                </Pill>
                                            </td>
                                            <td className={'px-6 py-4 font-bold text-white whitespace-nowrap'}>
                                                {order.total === 0 || order.payment_processor === 'free' ? (
                                                    <span css={tw`flex items-center gap-1.5`}>
                                                        <span>${order.total.toFixed(2)}</span>
                                                        <Pill size="small" type="success">
                                                            Free
                                                        </Pill>
                                                    </span>
                                                ) : (
                                                    <span>
                                                        ${order.total.toFixed(2)}
                                                        {order.type === 'ren' && (
                                                            <span css={tw`text-sm text-gray-400 ml-1`}>/mo</span>
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                            <td className={'px-6 py-4 text-gray-400 text-sm'}>
                                                {order.billing_days ? `${order.billing_days}d` : '—'}
                                            </td>
                                            <td className={'px-6 py-4 text-gray-400'}>
                                                {formatDistanceToNowStrict(order.created_at, { addSuffix: true })}
                                            </td>
                                        </tr>
                                    ))}
                            </TableBody>
                        </table>
                        {orders === undefined ? <Loading /> : orders.items.length < 1 ? <NoItems /> : null}
                    </div>
                </Pagination>
            </AdminTable>

            {/* Order Inspector Modal */}
            {selectedOrder && (
                <OrderInspectorModal
                    order={selectedOrder}
                    isOpen={isInspectorOpen}
                    onClose={closeInspector}
                    isAdmin={false}
                />
            )}
        </PageContentBlock>
    );
}

export default () => {
    const hooks = useTableHooks<OrderFilters>();
    const [tab, setTab] = useState<'orders' | 'invoices'>('orders');

    return (
        <OrderContext.Provider value={hooks}>
            {/* Tab switcher */}
            <div className="flex border-b border-neutral-700 mb-6">
                {(['orders', 'invoices'] as const).map(t => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-5 py-2.5 text-sm font-medium transition-colors capitalize ${
                            tab === t
                                ? 'border-b-2 border-blue-500 text-blue-400'
                                : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                    >
                        {t}
                    </button>
                ))}
            </div>
            {tab === 'orders' ? <OrderTable /> : <InvoicesTab />}
        </OrderContext.Provider>
    );
};
