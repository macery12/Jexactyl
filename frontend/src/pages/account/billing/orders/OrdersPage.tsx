import { m } from '@/i18n';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import OrdersTab from './OrdersTab';
import InvoicesTab from './InvoicesTab';

type TabId = 'orders' | 'invoices';

// Billing history — order list (filterable, sortable, with a detail modal) and
// invoice list (with PDF download). Mirrors V1's OrdersContainer.
export default function OrdersPage() {
    const [tab, setTab] = useState<TabId>('orders');

    const tabs: { id: TabId; label: string }[] = [
        { id: 'orders', label: m['billing.orders.tabs.orders']() },
        { id: 'invoices', label: m['billing.orders.tabs.invoices']() },
    ];

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['billing.orders.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['billing.orders.subtitle']()}</p>
            </div>

            <div className="flex gap-1 border-b border-[var(--color-border)]">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'relative px-4 py-2 text-sm font-medium transition-colors',
                            tab === t.id
                                ? 'text-[var(--color-ink)]'
                                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        {t.label}
                        {tab === t.id && (
                            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--brand)]" />
                        )}
                    </button>
                ))}
            </div>

            {tab === 'orders' ? <OrdersTab /> : <InvoicesTab />}
        </div>
    );
}
