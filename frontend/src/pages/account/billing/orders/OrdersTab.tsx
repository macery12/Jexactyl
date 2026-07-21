import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ListFilter,
    Search,
    X,
} from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import {
    getOrders,
    type Order,
    type OrderFilters,
    type OrderSort,
    type OrderStatus,
    type OrderType,
    type PaymentProcessor,
} from '@/api/orders';
import { timeAgo } from '@/lib/format';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { StatusPill, ProcessorBadge, orderTypeLabel, money } from './parts';
import OrderDetailModal from './OrderDetailModal';

function SortHeader({
    label,
    active,
    desc,
    onClick,
    className,
}: {
    label: string;
    active: boolean;
    desc: boolean;
    onClick: () => void;
    className?: string;
}) {
    return (
        <th className={cn('px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]', className)}>
            <button
                type="button"
                onClick={onClick}
                className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-ink)]"
            >
                {label}
                {active &&
                    (desc ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
            </button>
        </th>
    );
}

function PlainHeader({ label, className }: { label: string; className?: string }) {
    return (
        <th className={cn('px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]', className)}>
            {label}
        </th>
    );
}

export default function OrdersTab() {
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<OrderSort>('created_at');
    const [sortDesc, setSortDesc] = useState(true);

    // Filter inputs
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [processor, setProcessor] = useState<PaymentProcessor | ''>('');
    const [status, setStatus] = useState<OrderStatus | ''>('');
    const [type, setType] = useState<OrderType | ''>('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    const [selected, setSelected] = useState<Order | null>(null);

    // Debounce the search box.
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput.trim()), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters: OrderFilters = useMemo(
        () => ({
            paymentProcessor: processor || null,
            status: status || null,
            type: type || null,
            minAmount: minAmount ? Number(minAmount) : null,
            maxAmount: maxAmount ? Number(maxAmount) : null,
            startDate: startDate || null,
            endDate: endDate || null,
            search: search || null,
        }),
        [processor, status, type, minAmount, maxAmount, startDate, endDate, search],
    );

    // Reset to page 1 whenever filters/sort change.
    useEffect(() => {
        setPage(1);
    }, [filters, sort, sortDesc]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['account', 'orders', { page, sort, sortDesc, filters }],
        queryFn: () => getOrders(page, filters, sort, sortDesc),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    const activeFilterCount = [processor, status, type, minAmount, maxAmount, startDate, endDate, search].filter(
        Boolean,
    ).length;

    const clearFilters = () => {
        setProcessor('');
        setStatus('');
        setType('');
        setMinAmount('');
        setMaxAmount('');
        setStartDate('');
        setEndDate('');
        setSearchInput('');
        setSearch('');
    };

    const toggleSort = (col: OrderSort) => {
        if (sort === col) {
            setSortDesc(d => !d);
        } else {
            setSort(col);
            setSortDesc(true);
        }
    };

    const processorOptions = [
        { value: '', label: m['billing.orders.filter.anyProcessor']() },
        { value: 'stripe', label: m['billing.orders.processor.stripe']() },
        { value: 'paypal', label: m['billing.orders.processor.paypal']() },
        { value: 'free', label: m['billing.orders.processor.free']() },
    ];
    const statusOptions = [
        { value: '', label: m['billing.orders.filter.anyStatus']() },
        { value: 'processed', label: m['billing.orders.status.processed']() },
        { value: 'pending', label: m['billing.orders.status.pending']() },
        { value: 'failed', label: m['billing.orders.status.failed']() },
        { value: 'cancelled', label: m['billing.orders.status.cancelled']() },
        { value: 'expired', label: m['billing.orders.status.expired']() },
    ];
    const typeOptions = [
        { value: '', label: m['billing.orders.filter.anyType']() },
        { value: 'new', label: m['billing.orders.type.new']() },
        { value: 'ren', label: m['billing.orders.type.ren']() },
        { value: 'upg', label: m['billing.orders.type.upg']() },
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* Search + filters toolbar */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                        <Input
                            value={searchInput}
                            placeholder={m['billing.orders.searchPlaceholder']()}
                            className="pl-9"
                            onChange={e => setSearchInput(e.target.value)}
                        />
                    </div>
                    <Button variant={showFilters ? 'secondary' : 'outline'} onClick={() => setShowFilters(v => !v)}>
                        <ListFilter className="h-4 w-4" />
                        {m['billing.orders.filters']()}
                        {activeFilterCount > 0 && (
                            <span className="ml-1 rounded-full bg-[var(--brand)]/20 px-1.5 text-xs text-[var(--brand)]">
                                {activeFilterCount}
                            </span>
                        )}
                        {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    {activeFilterCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearFilters}>
                            <X className="h-4 w-4" />
                            {m['common.actions.clear']()}
                        </Button>
                    )}
                </div>

                {showFilters && (
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Select
                            value={processor}
                            onChange={v => setProcessor(v as PaymentProcessor | '')}
                            options={processorOptions}
                        />
                        <Select
                            value={status}
                            onChange={v => setStatus(v as OrderStatus | '')}
                            options={statusOptions}
                        />
                        <Select value={type} onChange={v => setType(v as OrderType | '')} options={typeOptions} />
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                value={minAmount}
                                onChange={e => setMinAmount(e.target.value)}
                                placeholder={m['billing.orders.filter.minAmount']()}
                            />
                            <Input
                                type="number"
                                value={maxAmount}
                                onChange={e => setMaxAmount(e.target.value)}
                                placeholder={m['billing.orders.filter.maxAmount']()}
                            />
                        </div>
                        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px]">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                <SortHeader
                                    label={m['billing.orders.col.id']()}
                                    active={sort === 'id'}
                                    desc={sortDesc}
                                    onClick={() => toggleSort('id')}
                                />
                                <PlainHeader label={m['billing.orders.col.server']()} />
                                <PlainHeader label={m['billing.orders.col.product']()} />
                                <PlainHeader label={m['billing.orders.col.type']()} />
                                <PlainHeader label={m['billing.orders.col.provider']()} />
                                <PlainHeader label={m['billing.orders.col.status']()} />
                                <SortHeader
                                    label={m['billing.orders.col.amount']()}
                                    active={sort === 'total'}
                                    desc={sortDesc}
                                    onClick={() => toggleSort('total')}
                                />
                                <PlainHeader label={m['billing.orders.col.period']()} />
                                <SortHeader
                                    label={m['billing.orders.col.created']()}
                                    active={sort === 'created_at'}
                                    desc={sortDesc}
                                    onClick={() => toggleSort('created_at')}
                                />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {items.map(order => (
                                <tr
                                    key={order.id}
                                    onClick={() => setSelected(order)}
                                    className="cursor-pointer transition-colors hover:bg-[var(--color-surface-2)]"
                                >
                                    <td className="px-4 py-3">
                                        <code className="rounded bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-ink-muted)]">
                                            #{order.id}
                                        </code>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink)]">
                                        {order.serverName || order.name || (
                                            <span className="text-[var(--color-ink-faint)]">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        {order.productName || <span className="text-[var(--color-ink-faint)]">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        {orderTypeLabel(order.type)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <ProcessorBadge processor={order.paymentProcessor} />
                                    </td>
                                    <td className="px-4 py-3">
                                        <StatusPill status={order.status} />
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-[var(--color-ink)]">
                                        {money(order.total)}
                                        {order.type === 'ren' && (
                                            <span className="ml-1 text-xs font-normal text-[var(--color-ink-faint)]">
                                                {m['billing.orders.perMonth']()}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        {order.billingDays
                                            ? m['billing.orders.detail.days']({ count: order.billingDays })
                                            : '—'}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--color-ink-faint)]">
                                        {timeAgo(order.createdAt)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : items.length === 0 ? (
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-ink-muted)]">
                        {m['billing.orders.empty']()}
                    </p>
                ) : null}
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.currentPage, total: pagination.totalPages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage <= 1 || isFetching}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage >= pagination.totalPages || isFetching}
                            onClick={() => setPage(p => p + 1)}
                        >
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <OrderDetailModal order={selected} onClose={() => setSelected(null)} />
        </div>
    );
}
