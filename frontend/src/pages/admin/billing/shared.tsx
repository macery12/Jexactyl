import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import type { OrderStatus, PaymentProcessor } from '@/api/adminBillingOrders';

// Shared presentational atoms for the admin billing tables + inspector modal.
// All colours come from theme status tokens. Mirrors the account-side parts.tsx
// so orders/invoices read identically across the two areas.

const STATUS_TONE: Record<OrderStatus, string> = {
    processed: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] border-[var(--color-accent)]/30',
    failed: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/30',
    cancelled: 'bg-[var(--brand)]/12 text-[var(--brand)] border-[var(--brand)]/30',
    pending: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/30',
    expired: 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] border-[var(--color-border-strong)]',
};

const STATUS_LABEL: Record<OrderStatus, () => string> = {
    processed: () => m['billing.orders.status.processed'](),
    failed: () => m['billing.orders.status.failed'](),
    cancelled: () => m['billing.orders.status.cancelled'](),
    pending: () => m['billing.orders.status.pending'](),
    expired: () => m['billing.orders.status.expired'](),
};

export function StatusPill({ status }: { status: OrderStatus }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                STATUS_TONE[status] ?? STATUS_TONE.expired,
            )}
        >
            {(STATUS_LABEL[status] ?? (() => status))()}
        </span>
    );
}

export function orderTypeLabel(type: string): string {
    switch (type) {
        case 'new':
            return m['billing.orders.type.new']();
        case 'ren':
            return m['billing.orders.type.ren']();
        case 'upg':
            return m['billing.orders.type.upg']();
        default:
            return '—';
    }
}

const PROCESSOR_TONE: Record<PaymentProcessor, string> = {
    stripe: 'bg-[var(--brand)]/12 text-[var(--brand)] border-[var(--brand)]/30',
    paypal: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/30',
    free: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] border-[var(--color-accent)]/30',
};

const PROCESSOR_LABEL: Record<PaymentProcessor, () => string> = {
    stripe: () => m['billing.orders.processor.stripe'](),
    paypal: () => m['billing.orders.processor.paypal'](),
    free: () => m['billing.orders.processor.free'](),
};

export function ProcessorBadge({ processor }: { processor: PaymentProcessor }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                PROCESSOR_TONE[processor] ?? PROCESSOR_TONE.free,
            )}
        >
            {(PROCESSOR_LABEL[processor] ?? (() => processor))()}
        </span>
    );
}

// Threat index → pill tone. -1 means "not scored".
export function ThreatPill({ value }: { value: number }) {
    if (value < 0) return <span className="text-[var(--color-ink-faint)]">—</span>;
    const tone =
        value >= 50
            ? 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/30'
            : value >= 25
              ? 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/30'
              : 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] border-[var(--color-accent)]/30';
    return (
        <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', tone)}>
            {value}
        </span>
    );
}

// Shared pagination controls for the billing tables.
export function paginationLabel(current: number, total: number) {
    return m['activity.pageOf']({ current, total });
}
