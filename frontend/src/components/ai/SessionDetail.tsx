import { AlertTriangle, ChevronUp } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';

// Everything true about this conversation that is not something someone said.
//
// It exists because the answer to "what is happening right now" used to live in
// four places at once: a step counter above the composer, a queue banner inside
// the transcript, an activity row at its foot, and an assist banner between
// them. One column, always in the same place, is the whole idea.
//
// Deliberately not a panel. No fills, no cards, no header backgrounds — it sits
// on the same canvas as the transcript and separates with hairlines, because a
// second block of chrome beside a chromeless transcript would undo the reason
// the transcript is chromeless. What it does spend is a single colour, on the
// one row that is actionable: a pending approval. Nothing else here is allowed
// a fill, so that block cannot be missed without needing to animate.

export interface DetailRow {
    label: string;
    value: string;
    tone?: 'default' | 'good' | 'warn' | 'bad';
    /** 0–1. Renders a 2px rule under the row; "nearly out" reads before the digits do. */
    meter?: number;
    /** Colours the meter as a warning rather than as progress. */
    meterWarn?: boolean;
}

export interface DetailGroup {
    label: string;
    rows: DetailRow[];
}

const TONE: Record<NonNullable<DetailRow['tone']>, string> = {
    default: 'text-[var(--color-ink)]',
    good: 'text-[var(--color-accent)]',
    warn: 'text-[var(--color-warning)]',
    bad: 'text-[var(--color-danger)]',
};

export function SessionDetail({
    groups,
    pending,
    onReviewPending,
    className,
}: {
    groups: DetailGroup[];
    /** How many approvals are still waiting on a decision. */
    pending: number;
    /**
     * Scroll the transcript to the oldest undecided approval.
     *
     * The decision itself deliberately stays on the card. A destructive approval
     * demands the server's name typed out, and reproducing that flow in a 198px
     * column would mean two implementations of the one gate that must never
     * disagree — so this points at the card instead of duplicating it.
     */
    onReviewPending?: () => void;
    className?: string;
}) {
    const visible = groups.filter(group => group.rows.length > 0);

    return (
        <div className={cn('flex flex-col overflow-y-auto', className)}>
            {pending > 0 && (
                <div className="border-b border-[var(--color-border)] p-3">
                    <div className="flex flex-col gap-1.5 border-l-2 border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-2.5 py-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-warning)]">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {m['server.ai.detail.pendingCount']({ count: pending })}
                        </div>
                        {onReviewPending && (
                            <button
                                type="button"
                                onClick={onReviewPending}
                                className="self-start rounded-sm border border-[var(--color-border-strong)] px-2 py-0.5 text-[11px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                            >
                                {m['server.ai.detail.review']()}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {visible.map(group => (
                <div key={group.label} className="border-b border-[var(--color-border)] px-3 pb-2.5 pt-2.5">
                    <p className="pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                        {group.label}
                    </p>

                    {group.rows.map(row => (
                        <div key={row.label}>
                            <div className="flex items-baseline gap-2 py-[1px] font-mono text-[10.5px]">
                                <span className="w-[4.25rem] shrink-0 text-[var(--color-ink-faint)]">
                                    {row.label}
                                </span>
                                <span
                                    title={row.value}
                                    className={cn(
                                        'min-w-0 flex-1 truncate tabular-nums',
                                        TONE[row.tone ?? 'default'],
                                    )}
                                >
                                    {row.value}
                                </span>
                            </div>

                            {row.meter !== undefined && (
                                <div className="my-1 h-0.5 bg-[var(--color-surface-2)]">
                                    <span
                                        className={cn(
                                            'block h-full',
                                            row.meterWarn
                                                ? 'bg-[var(--color-warning)]'
                                                : 'bg-[var(--brand)]',
                                        )}
                                        style={{ width: `${Math.round(Math.min(1, Math.max(0, row.meter)) * 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

/**
 * The same content below the breakpoint, re-anchored.
 *
 * A vertical stack of key/value rows is the one shape that moves between a right
 * column and a bottom sheet without being redrawn, which is the reason this
 * layout survives a phone at all. Collapsed it shows only the pending count,
 * because that is the single thing worth interrupting for.
 */
export function SessionDetailSheet({
    groups,
    pending,
    open,
    onToggle,
    onReviewPending,
}: {
    groups: DetailGroup[];
    pending: number;
    open: boolean;
    onToggle: () => void;
    onReviewPending?: () => void;
}) {
    return (
        <div className="shrink-0 border-t border-[var(--color-border-strong)] bg-[var(--color-surface)]">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-muted)]"
            >
                <span aria-hidden className="h-0.5 w-6 rounded-full bg-[var(--color-border-strong)]" />
                {open ? m['server.ai.detail.hide']() : m['server.ai.detail.show']()}
                <span className="ml-auto flex items-center gap-1.5">
                    {pending > 0 && (
                        <span className="text-[var(--color-warning)]">
                            {m['server.ai.detail.pendingCount']({ count: pending })}
                        </span>
                    )}
                    <ChevronUp className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                </span>
            </button>

            {open && (
                <SessionDetail
                    groups={groups}
                    pending={pending}
                    onReviewPending={onReviewPending}
                    className="max-h-56"
                />
            )}
        </div>
    );
}
