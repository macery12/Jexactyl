import { m } from '@/i18n';
import type { MonthPoint, RenewalWindow } from '@/api/billing';
import { formatCurrency } from '@/lib/format';

// Theme-token colour for an order status (drives the composition bar + legend).
export function statusColor(status: string): string {
    switch (status) {
        case 'processed':
            return 'var(--color-accent)';
        case 'pending':
            return 'var(--color-warning)';
        case 'failed':
            return 'var(--color-danger)';
        case 'expired':
            return 'var(--color-ink-muted)';
        case 'cancelled':
            return 'var(--color-ink-faint)';
        default:
            return 'var(--brand)';
    }
}

// Theme-token colour for a payment processor slice.
export function processorColor(processor: string): string {
    switch (processor) {
        case 'stripe':
            return 'var(--brand)';
        case 'paypal':
            return 'var(--color-accent)';
        case 'manual':
            return 'var(--color-ink-muted)';
        case 'free':
            return 'var(--color-ink-faint)';
        default:
            return 'var(--color-warning)';
    }
}

// Monthly revenue — responsive CSS bar chart (no chart dependency). Solid
// brand bars with a hover tooltip; the tallest month sets the scale.
export function RevenueBars({ points }: { points: MonthPoint[] }) {
    const max = Math.max(...points.map(p => p.revenue), 1);
    const hasRevenue = points.some(p => p.revenue > 0);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-44 items-end gap-1.5">
                {points.map(p => {
                    const pct = Math.round((p.revenue / max) * 100);
                    return (
                        <div key={p.key} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
                            <div className="relative flex w-full flex-1 items-end">
                                <div
                                    className="w-full rounded-t-sm bg-[var(--brand)] transition-colors group-hover:bg-[var(--brand-bright)]"
                                    style={{ height: `${Math.max(pct, p.revenue > 0 ? 2 : 0)}%` }}
                                >
                                    <span className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-[var(--color-ink)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                        {formatCurrency(p.revenue)}
                                    </span>
                                </div>
                            </div>
                            <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">{p.label}</span>
                        </div>
                    );
                })}
            </div>
            {!hasRevenue && (
                <p className="text-center text-xs text-[var(--color-ink-faint)]">{m['admin.billing.overview.noRevenue']()}</p>
            )}
        </div>
    );
}

export interface CompositionSlice {
    key: string;
    label: string;
    color: string;
    count: number;
}

// Composition as one horizontal segmented bar plus a dot legend — the same
// treatment as the server-state bar on the /admin fleet board.
export function CompositionBar({ slices, emptyLabel }: { slices: CompositionSlice[]; emptyLabel: string }) {
    const total = slices.reduce((s, x) => s + x.count, 0);

    if (total === 0) {
        return <p className="text-xs text-[var(--color-ink-faint)]">{emptyLabel}</p>;
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-2 overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
                {slices.map(s => (
                    <div
                        key={s.key}
                        className="h-full"
                        style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
                    />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--color-ink-muted)]">
                {slices.map(s => (
                    <span key={s.key} className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
                        {s.label}
                        <span className="font-mono tabular-nums text-[var(--color-ink)]">{s.count}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// Upcoming-renewal windows as proportional horizontal bars (overdue → soon).
export function RenewalBars({
    rows,
}: {
    rows: { label: string; window: RenewalWindow; color: string }[];
}) {
    const max = Math.max(...rows.map(r => r.window.count), 1);
    return (
        <div className="flex flex-col gap-3">
            {rows.map(r => (
                <div key={r.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--color-ink-muted)]">{r.label}</span>
                        <span className="flex items-center gap-2">
                            <span className="font-mono tabular-nums text-[var(--color-ink)]">{r.window.count}</span>
                            <span className="font-mono tabular-nums text-[var(--color-ink-faint)]">
                                {formatCurrency(r.window.expectedRevenue)}
                            </span>
                        </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
                        <div
                            className="h-full"
                            style={{ width: `${Math.max((r.window.count / max) * 100, r.window.count > 0 ? 4 : 0)}%`, background: r.color }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
