import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListFilter, Search, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useBilling } from '@/state/billing';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
    getAdminOrders,
    type AdminOrder,
    type AdminOrderFilters,
    type AdminOrderSort,
    type OrderStatus,
    type PaymentProcessor,
} from '@/api/adminBillingOrders';
import { StatusPill, ProcessorBadge, ThreatPill, orderTypeLabel } from '../shared';
import OrderInspectorModal from './OrderInspectorModal';

// Parse the smart search box: bare text → search; #id / @user → search; and the
// txn:/cap:/pid:/pay: prefixes → the dedicated transaction-lookup filters.
function parseSearch(raw: string): Partial<AdminOrderFilters> {
    const t = raw.trim();
    if (!t) return {};
    if (t.startsWith('#') || t.startsWith('@')) return { search: t.slice(1).trim() };
    if (/^txn:/i.test(t)) return { transactionId: t.slice(4).trim() };
    if (/^cap:/i.test(t)) return { captureId: t.slice(4).trim() };
    if (/^pid:/i.test(t)) return { payerId: t.slice(4).trim() };
    if (/^pay:/i.test(t)) return { payerEmail: t.slice(4).trim() };
    return { search: t };
}

const PREFIX_HINTS = [
    { prefix: '#', key: 'admin.billing.orders.hint.id' as const },
    { prefix: '@', key: 'admin.billing.orders.hint.user' as const },
    { prefix: 'txn:', key: 'admin.billing.orders.hint.txn' as const },
    { prefix: 'cap:', key: 'admin.billing.orders.hint.cap' as const },
    { prefix: 'pid:', key: 'admin.billing.orders.hint.pid' as const },
    { prefix: 'pay:', key: 'admin.billing.orders.hint.pay' as const },
];

function SortHeader({
    label,
    active,
    desc,
    onClick,
}: {
    label: string;
    active: boolean;
    desc: boolean;
    onClick: () => void;
}) {
    return (
        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]">
            <button
                type="button"
                onClick={onClick}
                className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-ink)]"
            >
                {label}
                {active && (desc ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
            </button>
        </th>
    );
}

function PlainHeader({ label }: { label: string }) {
    return <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]">{label}</th>;
}

const ROW_TINT: Record<OrderStatus, string> = {
    failed: 'bg-[var(--color-danger)]/5 hover:bg-[var(--color-danger)]/10',
    cancelled: 'bg-[var(--brand)]/5 hover:bg-[var(--brand)]/10',
    pending: 'bg-[var(--color-warning)]/5 hover:bg-[var(--color-warning)]/10',
    processed: 'bg-[var(--color-accent)]/5 hover:bg-[var(--color-accent)]/10',
    expired: 'hover:bg-[var(--color-surface-2)]',
};

export default function OrdersPage() {
    const { money } = useBilling();
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<AdminOrderSort>('created_at');
    const [sortDesc, setSortDesc] = useState(true);

    const [searchInput, setSearchInput] = useState('');
    const [searchParsed, setSearchParsed] = useState<Partial<AdminOrderFilters>>({});
    const [processor, setProcessor] = useState<PaymentProcessor | ''>('');
    const [status, setStatus] = useState<OrderStatus | ''>('');
    const [type, setType] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [txnId, setTxnId] = useState('');
    const [capId, setCapId] = useState('');
    const [payerId, setPayerId] = useState('');
    const [payerEmail, setPayerEmail] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    const [selected, setSelected] = useState<AdminOrder | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setSearchParsed(parseSearch(searchInput)), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const filters: AdminOrderFilters = useMemo(
        () => ({
            paymentProcessor: processor || null,
            status: status || null,
            type: type || null,
            minAmount: minAmount ? Number(minAmount) : null,
            maxAmount: maxAmount ? Number(maxAmount) : null,
            startDate: startDate || null,
            endDate: endDate || null,
            search: searchParsed.search ?? null,
            transactionId: searchParsed.transactionId ?? (txnId.trim() || null),
            captureId: searchParsed.captureId ?? (capId.trim() || null),
            payerId: searchParsed.payerId ?? (payerId.trim() || null),
            payerEmail: searchParsed.payerEmail ?? (payerEmail.trim() || null),
        }),
        [processor, status, type, minAmount, maxAmount, startDate, endDate, searchParsed, txnId, capId, payerId, payerEmail],
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setPage(1);
    }, [filters, sort, sortDesc]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['admin', 'billing', 'orders', { page, sort, sortDesc, filters }],
        queryFn: () => getAdminOrders(page, filters, sort, sortDesc),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    const activeFilterCount = [
        processor,
        status,
        type,
        minAmount,
        maxAmount,
        startDate,
        endDate,
        searchInput.trim(),
        txnId.trim(),
        capId.trim(),
        payerId.trim(),
        payerEmail.trim(),
    ].filter(Boolean).length;

    const clearFilters = () => {
        setProcessor('');
        setStatus('');
        setType('');
        setMinAmount('');
        setMaxAmount('');
        setStartDate('');
        setEndDate('');
        setSearchInput('');
        setSearchParsed({});
        setTxnId('');
        setCapId('');
        setPayerId('');
        setPayerEmail('');
    };

    const toggleSort = (col: AdminOrderSort) => {
        if (sort === col) setSortDesc(d => !d);
        else {
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
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.orders.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.orders.subtitle']()}</p>
            </div>

            {/* Toolbar */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                        <Input
                            value={searchInput}
                            placeholder={m['admin.billing.orders.searchPlaceholder']()}
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

                {/* Prefix hint chips */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {PREFIX_HINTS.map(h => (
                        <button
                            key={h.prefix}
                            type="button"
                            onClick={() => setSearchInput(h.prefix)}
                            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-2 py-0.5 font-mono text-[11px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]"
                        >
                            {m[h.key]()}
                        </button>
                    ))}
                </div>

                {showFilters && (
                    <div className="mt-3 flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Select value={processor} onChange={v => setProcessor(v as PaymentProcessor | '')} options={processorOptions} />
                            <Select value={status} onChange={v => setStatus(v as OrderStatus | '')} options={statusOptions} />
                            <Select value={type} onChange={setType} options={typeOptions} />
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

                        <div className="border-t border-[var(--color-border)] pt-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                                {m['admin.billing.orders.txnLookup']()}
                            </p>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <Input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder={m['admin.billing.orders.txnId']()} />
                                <Input value={capId} onChange={e => setCapId(e.target.value)} placeholder={m['admin.billing.orders.capId']()} />
                                <Input value={payerId} onChange={e => setPayerId(e.target.value)} placeholder={m['admin.billing.orders.payerId']()} />
                                <Input value={payerEmail} onChange={e => setPayerEmail(e.target.value)} placeholder={m['admin.billing.orders.payerEmail']()} />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px]">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                <SortHeader label={m['billing.orders.col.id']()} active={sort === 'id'} desc={sortDesc} onClick={() => toggleSort('id')} />
                                <PlainHeader label={m['admin.billing.orders.col.customer']()} />
                                <PlainHeader label={m['billing.orders.col.server']()} />
                                <PlainHeader label={m['billing.orders.col.product']()} />
                                <PlainHeader label={m['billing.orders.col.type']()} />
                                <PlainHeader label={m['billing.orders.col.provider']()} />
                                <PlainHeader label={m['billing.orders.col.status']()} />
                                <PlainHeader label={m['admin.billing.orders.col.threat']()} />
                                <SortHeader label={m['billing.orders.col.amount']()} active={sort === 'total'} desc={sortDesc} onClick={() => toggleSort('total')} />
                                <SortHeader label={m['billing.orders.col.created']()} active={sort === 'created_at'} desc={sortDesc} onClick={() => toggleSort('created_at')} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {items.map(order => (
                                <tr
                                    key={order.id}
                                    onClick={() => setSelected(order)}
                                    className={cn('cursor-pointer transition-colors', ROW_TINT[order.status] ?? ROW_TINT.expired)}
                                >
                                    <td className="px-4 py-3">
                                        <code className="rounded bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-ink-muted)]">
                                            #{order.id}
                                        </code>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        {order.username ? (
                                            <div className="min-w-0">
                                                <p className="truncate font-medium text-[var(--color-ink)]">{order.username}</p>
                                                {order.userEmail && (
                                                    <p className="truncate text-xs text-[var(--color-ink-faint)]">{order.userEmail}</p>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-[var(--color-ink-muted)]">
                                                {m['admin.billing.orders.userN']({ id: order.userId ?? 0 })}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink)]">
                                        {order.serverName || order.name || <span className="text-[var(--color-ink-faint)]">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        {order.productName || <span className="text-[var(--color-ink-faint)]">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">{orderTypeLabel(order.type)}</td>
                                    <td className="px-4 py-3">
                                        <ProcessorBadge processor={order.paymentProcessor} />
                                    </td>
                                    <td className="px-4 py-3">
                                        <StatusPill status={order.status} />
                                    </td>
                                    <td className="px-4 py-3">
                                        <ThreatPill value={order.threatIndex} />
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-[var(--color-ink)]">
                                        {money(order.total)}
                                        {order.type === 'ren' && (
                                            <span className="ml-1 text-xs font-normal text-[var(--color-ink-faint)]">
                                                {m['billing.orders.perMonth']()}
                                            </span>
                                        )}
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
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-ink-muted)]">{m['billing.orders.empty']()}</p>
                ) : null}
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.currentPage, total: pagination.totalPages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={pagination.currentPage <= 1 || isFetching} onClick={() => setPage(p => Math.max(1, p - 1))}>
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button variant="outline" size="sm" disabled={pagination.currentPage >= pagination.totalPages || isFetching} onClick={() => setPage(p => p + 1)}>
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <OrderInspectorModal order={selected} onClose={() => setSelected(null)} />
        </div>
    );
}
