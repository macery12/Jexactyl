import Pill, { PillStatus } from '@/elements/Pill';
import { useGetOrders, Context as OrderContext } from '@/api/routes/admin/billing/orders';
import AdminTable, {
    Pagination,
    TableHead,
    TableHeader,
    TableBody,
    Loading,
    NoItems,
    useTableHooks,
} from '@/elements/AdminTable';
import CopyOnClick from '@/elements/CopyOnClick';
import tw from 'twin.macro';
import { useContext, useEffect, useState, useCallback, useRef, type UIEvent } from 'react';
import useFlash from '@/plugins/useFlash';
import { formatDistanceToNowStrict } from 'date-fns';
import { OrderFilters, PaymentProcessor, OrderStatus } from '@/api/routes/admin/billing/types';
import PaymentProcessorBadge from '@/components/elements/PaymentProcessorBadge';
import PaymentProcessorFilter from '@/components/elements/PaymentProcessorFilter';
import StatusFilter from '@/components/elements/StatusFilter';
import OrderTypeFilter from '@/components/elements/OrderTypeFilter';
import AmountRangeFilter from '@/components/elements/AmountRangeFilter';
import DateRangeFilter from '@/components/elements/DateRangeFilter';
import OrderInspectorModal from '@/components/elements/OrderInspectorModal';
import { Order } from '@definitions/admin/models';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faFilter, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import Input from '@/elements/Input';
import InputSpinner from '@/elements/InputSpinner';
import debounce from 'debounce';
import { useStoreState } from '@/state/hooks';

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

function OrderTable({ minimal }: { minimal?: boolean }) {
    const { data: orders, error } = useGetOrders();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { setSort, sort, setPage, sortDirection, setFilters } = useContext(OrderContext);
    const { colors } = useStoreState(state => state.theme.data!);

    // Filter states
    const [paymentProcessor, setPaymentProcessor] = useState<PaymentProcessor | null>(null);
    const [status, setStatus] = useState<OrderStatus | null>(null);
    const [orderType, setOrderType] = useState<string | null>(null);
    const [minAmount, setMinAmount] = useState<number | null>(null);
    const [maxAmount, setMaxAmount] = useState<number | null>(null);
    const [startDate, setStartDate] = useState<string | null>(null);
    const [endDate, setEndDate] = useState<string | null>(null);
    type SearchBarFilterType = 'search' | 'transaction_id' | 'capture_id' | 'payer_id' | 'payer_email';
    const [searchBarFilter, setSearchBarFilter] = useState<{ type: SearchBarFilterType; value: string } | null>(null);
    const [searchInputText, setSearchInputText] = useState<string>('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Admin-only transaction filter states
    const [transactionId, setTransactionId] = useState<string>('');
    const [captureId, setCaptureId] = useState<string>('');
    const [payerId, setPayerId] = useState<string>('');
    const [payerEmail, setPayerEmail] = useState<string>('');

    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);
    const topScrollRef = useRef<HTMLDivElement>(null);
    const bottomScrollRef = useRef<HTMLDivElement>(null);
    const syncingScrollRef = useRef<'top' | 'bottom' | null>(null);
    const tableMinWidth = minimal ? '64rem' : '88rem';

    const syncHorizontalScroll = useCallback(
        (source: 'top' | 'bottom') => (event: UIEvent<HTMLDivElement>) => {
            if (syncingScrollRef.current && syncingScrollRef.current !== source) {
                return;
            }

            const target = source === 'top' ? bottomScrollRef.current : topScrollRef.current;
            if (!target) return;

            syncingScrollRef.current = source;
            target.scrollLeft = event.currentTarget.scrollLeft;

            requestAnimationFrame(() => {
                syncingScrollRef.current = null;
            });
        },
        [],
    );

    const openInspector = (order: Order) => {
        setSelectedOrder(order);
        setIsInspectorOpen(true);
    };

    const closeInspector = () => {
        setIsInspectorOpen(false);
        setTimeout(() => setSelectedOrder(null), 300);
    };

    // Prefix-aware debounced search
    const debouncedApplySearch = useCallback(
        debounce((raw: string) => {
            const trimmed = raw.trim();
            if (!trimmed) {
                setSearchBarFilter(null);
                setSearchLoading(false);
                return;
            }
            if (trimmed.startsWith('#')) {
                setSearchBarFilter({ type: 'search', value: trimmed.slice(1).trim() });
            } else if (trimmed.startsWith('@')) {
                setSearchBarFilter({ type: 'search', value: trimmed.slice(1).trim() });
            } else if (/^txn:/i.test(trimmed)) {
                setSearchBarFilter({ type: 'transaction_id', value: trimmed.slice(4).trim() });
            } else if (/^cap:/i.test(trimmed)) {
                setSearchBarFilter({ type: 'capture_id', value: trimmed.slice(4).trim() });
            } else if (/^pid:/i.test(trimmed)) {
                setSearchBarFilter({ type: 'payer_id', value: trimmed.slice(4).trim() });
            } else if (/^pay:/i.test(trimmed)) {
                setSearchBarFilter({ type: 'payer_email', value: trimmed.slice(4).trim() });
            } else {
                setSearchBarFilter({ type: 'search', value: trimmed });
            }
            setSearchLoading(false);
        }, 300),
        [],
    );

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSearchInputText(value);
        if (!value.trim()) {
            setSearchBarFilter(null);
            setSearchLoading(false);
            return;
        }
        setSearchLoading(true);
        debouncedApplySearch(value);
    };

    // Build filters object
    const buildFilters = (): OrderFilters | null => {
        const filters: OrderFilters = {};
        let hasFilters = false;

        if (paymentProcessor) {
            filters.payment_processor = paymentProcessor;
            hasFilters = true;
        }
        if (status) {
            filters.status = status;
            hasFilters = true;
        }
        if (orderType) {
            filters.type = orderType;
            hasFilters = true;
        }
        if (minAmount !== null) {
            filters.min_amount = minAmount;
            hasFilters = true;
        }
        if (maxAmount !== null) {
            filters.max_amount = maxAmount;
            hasFilters = true;
        }
        if (startDate) {
            filters.start_date = startDate;
            hasFilters = true;
        }
        if (endDate) {
            filters.end_date = endDate;
            hasFilters = true;
        }
        if (searchBarFilter?.value) {
            if (searchBarFilter.type === 'search' && searchBarFilter.value.length >= 2) {
                filters.search = searchBarFilter.value;
                hasFilters = true;
            } else if (searchBarFilter.type === 'transaction_id' && searchBarFilter.value.length >= 2) {
                filters.transaction_id = searchBarFilter.value;
                hasFilters = true;
            } else if (searchBarFilter.type === 'capture_id' && searchBarFilter.value.length >= 2) {
                filters.capture_id = searchBarFilter.value;
                hasFilters = true;
            } else if (searchBarFilter.type === 'payer_id' && searchBarFilter.value.length >= 2) {
                filters.payer_id = searchBarFilter.value;
                hasFilters = true;
            } else if (searchBarFilter.type === 'payer_email' && searchBarFilter.value.length >= 2) {
                filters.payer_email = searchBarFilter.value;
                hasFilters = true;
            }
        }
        if (transactionId.trim()) {
            filters.transaction_id = transactionId.trim();
            hasFilters = true;
        }
        if (captureId.trim()) {
            filters.capture_id = captureId.trim();
            hasFilters = true;
        }
        if (payerId.trim()) {
            filters.payer_id = payerId.trim();
            hasFilters = true;
        }
        if (payerEmail.trim()) {
            filters.payer_email = payerEmail.trim();
            hasFilters = true;
        }
        if (transactionId.trim()) { filters.transaction_id = transactionId.trim(); hasFilters = true; }
        if (captureId.trim()) { filters.capture_id = captureId.trim(); hasFilters = true; }
        if (payerId.trim()) { filters.payer_id = payerId.trim(); hasFilters = true; }
        if (payerEmail.trim()) { filters.payer_email = payerEmail.trim(); hasFilters = true; }

        return hasFilters ? filters : null;
    };

    // Apply filters when any filter changes
    useEffect(() => {
        if (!minimal) {
            setFilters(buildFilters());
        }
    }, [
        paymentProcessor,
        status,
        orderType,
        minAmount,
        maxAmount,
        startDate,
        endDate,
        searchBarFilter,
        transactionId,
        captureId,
        payerId,
        payerEmail,
        minimal,
    ]);

    const clearFilters = () => {
        setPaymentProcessor(null);
        setStatus(null);
        setOrderType(null);
        setMinAmount(null);
        setMaxAmount(null);
        setStartDate(null);
        setEndDate(null);
        setSearchBarFilter(null);
        setSearchInputText('');
        setTransactionId('');
        setCaptureId('');
        setPayerId('');
        setPayerEmail('');
    };

    const hasActiveFilters =
        paymentProcessor ||
        status ||
        orderType ||
        minAmount !== null ||
        maxAmount !== null ||
        startDate ||
        endDate ||
        searchBarFilter?.value ||
        transactionId ||
        captureId ||
        payerId ||
        payerEmail;

    useEffect(() => {
        if (!error) {
            clearFlashes('admin:billing:orders');
            return;
        }

        clearAndAddHttpError({ key: 'admin:billing:orders', error });
    }, [error]);

    return (
        <>
            {!minimal && (
                <div
                    className={'rounded-lg shadow-md mb-6'}
                    style={{ backgroundColor: colors.background || colors.secondary }}
                >
                    <div css={tw`p-4`}>
                        {/* Smart Search Bar */}
                        <div css={tw`flex items-center gap-3 mb-2`}>
                            <div css={tw`flex-1`}>
                                <InputSpinner visible={searchLoading}>
                                    <Input
                                        ref={searchInputRef}
                                        value={searchInputText}
                                        placeholder="Search orders… (#ID, @user, txn:, cap:, pid:, pay:)"
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
                                                searchBarFilter?.value,
                                                transactionId,
                                                captureId,
                                                payerId,
                                                payerEmail,
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

                        {/* Search prefix hint chips */}
                        <div css={tw`flex flex-wrap gap-1.5 mb-3`}>
                            {(
                                [
                                    { prefix: '#', label: '# Order ID', title: 'Filter by order ID. e.g. #36' },
                                    {
                                        prefix: '@',
                                        label: '@ Username',
                                        title: 'Filter by username or email. e.g. @macery12',
                                    },
                                    {
                                        prefix: 'txn:',
                                        label: 'txn: Transaction',
                                        title: 'Filter by transaction ID. e.g. txn:5AM70990',
                                    },
                                    {
                                        prefix: 'cap:',
                                        label: 'cap: Capture ID',
                                        title: 'Filter by capture ID. e.g. cap:5KE26461',
                                    },
                                    {
                                        prefix: 'pid:',
                                        label: 'pid: Payer ID',
                                        title: 'Filter by PayPal payer ID. e.g. pid:BS2XZBZ',
                                    },
                                    {
                                        prefix: 'pay:',
                                        label: 'pay: Payer Email',
                                        title: 'Filter by payer email. e.g. pay:tester@',
                                    },
                                ] as const
                            ).map(({ prefix, label, title }) => (
                                <button
                                    key={prefix}
                                    title={title}
                                    onClick={() => {
                                        setSearchInputText(prefix);
                                        setSearchBarFilter(null);
                                        setTimeout(() => searchInputRef.current?.focus(), 0);
                                    }}
                                    css={tw`font-mono text-xs px-2 py-0.5 rounded border border-neutral-600 text-gray-400 hover:text-white hover:border-neutral-400 transition-colors`}
                                    style={{ backgroundColor: colors.secondary }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Collapsible Advanced Filters */}
                        {showFilters && (
                            <div css={tw`border-t border-neutral-700 pt-4 space-y-4`}>
                                {/* Standard filter dropdowns */}
                                <div css={tw`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`}>
                                    <PaymentProcessorFilter value={paymentProcessor} onChange={setPaymentProcessor} />
                                    <StatusFilter value={status} onChange={setStatus} />
                                    <OrderTypeFilter value={orderType as any} onChange={setOrderType as any} />
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

                                {/* Admin-only transaction filters */}
                                <div css={tw`border-t border-neutral-700 pt-3`}>
                                    <p css={tw`text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3`}>
                                        Transaction Lookup
                                    </p>
                                    <div css={tw`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3`}>
                                        <div>
                                            <label css={tw`block text-xs text-gray-400 mb-1`}>Transaction ID</label>
                                            <Input
                                                value={transactionId}
                                                placeholder="e.g. pi_3ABC..."
                                                onChange={e => setTransactionId(e.target.value)}
                                                style={{ backgroundColor: colors.secondary }}
                                            />
                                        </div>
                                        <div>
                                            <label css={tw`block text-xs text-gray-400 mb-1`}>Capture ID</label>
                                            <Input
                                                value={captureId}
                                                placeholder="e.g. ch_3ABC..."
                                                onChange={e => setCaptureId(e.target.value)}
                                                style={{ backgroundColor: colors.secondary }}
                                            />
                                        </div>
                                        <div>
                                            <label css={tw`block text-xs text-gray-400 mb-1`}>Payer ID</label>
                                            <Input
                                                value={payerId}
                                                placeholder="e.g. PAYPAL_PAYER_123"
                                                onChange={e => setPayerId(e.target.value)}
                                                style={{ backgroundColor: colors.secondary }}
                                            />
                                        </div>
                                        <div>
                                            <label css={tw`block text-xs text-gray-400 mb-1`}>Payer Email</label>
                                            <Input
                                                value={payerEmail}
                                                placeholder="payer@example.com"
                                                onChange={e => setPayerEmail(e.target.value)}
                                                style={{ backgroundColor: colors.secondary }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <AdminTable>
                <Pagination data={orders} onPageSelect={setPage}>
                    <div
                        ref={topScrollRef}
                        css={tw`mb-2 w-full overflow-x-auto overflow-y-hidden`}
                        onScroll={syncHorizontalScroll('top')}
                    >
                        <div style={{ width: tableMinWidth, height: '1px' }} />
                    </div>

                    <div
                        ref={bottomScrollRef}
                        css={tw`w-full overflow-x-auto`}
                        onScroll={syncHorizontalScroll('bottom')}
                    >
                        <table css={tw`w-full table-auto`} style={{ minWidth: tableMinWidth }}>
                            <TableHead>
                                {!minimal && (
                                    <TableHeader
                                        name={'Order ID'}
                                        direction={sort === 'id' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('id')}
                                    />
                                )}
                                {!minimal && <TableHeader name={'Customer'} />}
                                <TableHeader name={'Server'} />
                                <TableHeader name={'Product'} />
                                <TableHeader name={'Type'} />
                                <TableHeader name={'Provider'} />
                                <TableHeader name={'Status'} />
                                <TableHeader name={'Threat'} />
                                <TableHeader
                                    name={'Amount'}
                                    direction={sort === 'total' ? (sortDirection ? 1 : 2) : null}
                                    onClick={() => setSort('total')}
                                />
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
                                            className={`h-12 cursor-pointer transition-colors ${
                                                !minimal ? getStatusRowClass(order.status) : 'hover:bg-neutral-700'
                                            }`}
                                            onClick={() => !minimal && openInspector(order)}
                                        >
                                            {!minimal && (
                                                <td css={tw`px-6 py-4 text-sm text-left whitespace-nowrap`}>
                                                    <CopyOnClick text={order.id.toString()}>
                                                        <code
                                                            css={tw`font-mono bg-neutral-900 rounded py-1 px-2 text-gray-300 hover:text-white transition-colors`}
                                                        >
                                                            {order.id}
                                                        </code>
                                                    </CopyOnClick>
                                                </td>
                                            )}
                                            {!minimal && (
                                                <td css={tw`px-6 py-4 text-sm`}>
                                                    {order.username ? (
                                                        <div>
                                                            <div css={tw`text-white font-medium`}>{order.username}</div>
                                                            {order.user_email && (
                                                                <div css={tw`text-gray-500 text-xs`}>
                                                                    {order.user_email}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span css={tw`text-gray-400`}>User #{order.user_id}</span>
                                                    )}
                                                </td>
                                            )}
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
                                            <td className={'px-6 py-4'}>
                                                {order.threat_index >= 0 ? (
                                                    <Pill
                                                        size={'small'}
                                                        type={
                                                            order.threat_index >= 50
                                                                ? 'danger'
                                                                : order.threat_index >= 25
                                                                  ? 'warn'
                                                                  : 'success'
                                                        }
                                                    >
                                                        {order.threat_index}
                                                    </Pill>
                                                ) : (
                                                    <span className={'text-gray-600'}>—</span>
                                                )}
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
            {!minimal && selectedOrder && (
                <OrderInspectorModal
                    order={selectedOrder}
                    isOpen={isInspectorOpen}
                    onClose={closeInspector}
                    isAdmin={true}
                />
            )}
        </>
    );
}

export default ({ name, minimal }: { name?: string; minimal?: boolean }) => {
    const hooks = useTableHooks<OrderFilters>({ name: name });

    return (
        <OrderContext.Provider value={hooks}>
            <OrderTable minimal={minimal} />
        </OrderContext.Provider>
    );
};
