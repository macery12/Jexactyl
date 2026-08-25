import { m } from '@/i18n/messages';
import { Fragment, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

// Shared building blocks for the admin dashboards (/admin overview and the
// billing overview) so both speak the same visual language: flat solid-surface
// panels, mono figures, uppercase micro-labels, and a terse status line.

export type Tone = 'brand' | 'accent' | 'warning' | 'danger';

export const toneText: Record<Tone, string> = {
    brand: 'text-[var(--brand-bright)]',
    accent: 'text-[var(--color-accent)]',
    warning: 'text-[var(--color-warning)]',
    danger: 'text-[var(--color-danger)]',
};
export const toneBar: Record<Tone, string> = {
    brand: 'bg-[var(--brand)]',
    accent: 'bg-[var(--color-accent)]',
    warning: 'bg-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger)]',
};

export function panelClass(extra?: string) {
    return cn(
        'rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5',
        extra,
    );
}

export function PanelHeader({ title, to, action }: { title: string; to?: string; action?: string }) {
    return (
        <div className="mb-4 flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{title}</h2>
            {to && action && (
                <Link to={to} className="ml-auto text-xs font-semibold text-[var(--brand-bright)] hover:underline">
                    {action}
                </Link>
            )}
        </div>
    );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
            {label}
        </span>
    );
}

export function KpiTile({
    icon: Icon,
    label,
    value,
    sub,
    tone,
    to,
}: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    sub?: ReactNode;
    tone?: Extract<Tone, 'accent' | 'warning'>;
    to?: string;
}) {
    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">
                    {label}
                </p>
                <Icon className={cn('h-4 w-4 shrink-0', tone ? toneText[tone] : 'text-[var(--color-ink-faint)]')} />
            </div>
            <p
                className={cn(
                    'mt-1.5 font-mono text-2xl font-semibold tabular-nums',
                    tone === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink)]',
                )}
            >
                {value}
            </p>
            {sub && <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">{sub}</p>}
        </>
    );

    const className = cn(
        'flex flex-col rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3.5',
        to && 'transition-colors hover:bg-[var(--color-surface-2)]',
    );

    return to ? (
        <Link to={to} className={className}>
            {body}
        </Link>
    ) : (
        <div className={className}>{body}</div>
    );
}

export interface AttentionItem {
    key: string;
    label: string;
    to?: string;
}

/**
 * Terse ops status line: a tone edge + one mono sentence. `info` is the
 * always-present token after the state word (panel version, MRR, …); attention
 * items are plain inline links, not chips — the line reads like console output.
 */
export function StatusLine({ items, info }: { items: AttentionItem[]; info: ReactNode }) {
    const clear = items.length === 0;
    return (
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-xs">
            <span className={cn('absolute inset-y-0 left-0 w-[3px]', clear ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-warning)]')} />
            <span
                className={cn(
                    'font-semibold uppercase tracking-[0.14em]',
                    clear ? 'text-[var(--color-accent)]' : 'text-[var(--color-warning)]',
                )}
            >
                {clear ? m['admin.overview.status.clear']() : m['admin.overview.attention.label']()}
            </span>
            <span className="text-[var(--color-ink-faint)]">·</span>
            <span className="text-[var(--color-ink-muted)]">{info}</span>
            {items.map(item => (
                <Fragment key={item.key}>
                    <span className="text-[var(--color-ink-faint)]">·</span>
                    {item.to ? (
                        <Link
                            to={item.to}
                            className="text-[var(--color-ink)] underline decoration-[var(--color-warning)]/60 underline-offset-4 hover:text-[var(--color-warning)]"
                        >
                            {item.label}
                        </Link>
                    ) : (
                        <span className="text-[var(--color-ink)]">{item.label}</span>
                    )}
                </Fragment>
            ))}
        </div>
    );
}
