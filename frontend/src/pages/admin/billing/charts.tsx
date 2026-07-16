import { m, td } from '@/i18n';
import type { MonthPoint, StatusSlice, RenewalWindow } from '@/api/billing';
import { formatCurrency } from '@/lib/format';

// Theme-token colour for an order status (drives the donut + legend).
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

// Monthly revenue — responsive CSS bar chart (no chart dependency). Bars are
// brand-toned with a hover tooltip; the tallest month sets the scale.
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
                                    className="w-full rounded-t-sm bg-[var(--brand)]/70 transition-all group-hover:bg-[var(--brand)]"
                                    style={{ height: `${Math.max(pct, p.revenue > 0 ? 2 : 0)}%` }}
                                >
                                    <span className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                        {formatCurrency(p.revenue)}
                                    </span>
                                </div>
                            </div>
                            <span className="text-[10px] tabular-nums text-[var(--color-ink-faint)]">{p.label}</span>
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

// Order-status composition — an SVG donut with a centre total and a legend.
export function StatusDonut({ slices }: { slices: StatusSlice[] }) {
    const total = slices.reduce((s, x) => s + x.count, 0);
    const r = 52;
    const C = 2 * Math.PI * r;
    let offset = 0;

    return (
        <div className="flex items-center gap-5">
            <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0">
                <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth="14" />
                {total > 0 &&
                    slices.map(s => {
                        const len = (s.count / total) * C;
                        const el = (
                            <circle
                                key={s.status}
                                cx="60"
                                cy="60"
                                r={r}
                                fill="none"
                                stroke={statusColor(s.status)}
                                strokeWidth="14"
                                strokeDasharray={`${len} ${C - len}`}
                                strokeDashoffset={-offset}
                                transform="rotate(-90 60 60)"
                            />
                        );
                        offset += len;
                        return el;
                    })}
                <text x="60" y="56" textAnchor="middle" className="fill-[var(--color-ink)] text-[18px] font-semibold tabular-nums">
                    {total}
                </text>
                <text x="60" y="72" textAnchor="middle" className="fill-[var(--color-ink-faint)] text-[9px] uppercase tracking-widest">
                    {m['admin.billing.overview.ordersLabel']()}
                </text>
            </svg>
            <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                {slices.length === 0 && (
                    <li className="text-xs text-[var(--color-ink-faint)]">{m['admin.billing.overview.noOrders']()}</li>
                )}
                {slices.map(s => (
                    <li key={s.status} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: statusColor(s.status) }} />
                        <span className="flex-1 truncate capitalize text-[var(--color-ink-muted)]">
                            {td(`admin.billing.overview.status.${s.status}`, s.status)}
                        </span>
                        <span className="font-mono tabular-nums text-[var(--color-ink)]">{s.count}</span>
                    </li>
                ))}
            </ul>
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
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${Math.max((r.window.count / max) * 100, r.window.count > 0 ? 4 : 0)}%`, background: r.color }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
