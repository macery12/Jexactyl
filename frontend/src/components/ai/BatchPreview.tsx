import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import type { AiBatchPreview, AiRisk } from '@/lib/aiStream';
import { ToolArgs } from './ToolArgs';
import { ToolIcon, toolLabel, toolTarget } from './toolMeta';

// The calls a batch will make, before any of them run.
//
// This is the whole feature as far as the user is concerned. A batch exists so
// that twenty product creations are one decision rather than twenty, and that
// only holds if the one decision is actually informed — otherwise it is
// auto-approval with a click attached.
//
// The rule used to be "nothing is hidden, only folded", which was not enough:
// calls seven onward were folded away and every call's arguments were folded
// shut, while the approve button stayed live the whole time. One click could
// therefore commit an unreviewed tail, and the only thing standing in for the
// evidence was a summary the model wrote about its own work.
//
// So folding is now separated from reviewing. Every call above SAFE has to be
// opened — its exact arguments put on screen — before the set can be approved,
// and the card says how many are outstanding. Reads still fold quietly: they
// change nothing, and demanding ceremony for them would train people to click
// through the ones that matter.
//
// The collapsed row carries the verb and the tool's primary argument, which for
// a product is its name. That pairing is what makes a list of twenty scannable —
// "Create product / Budget 4GB" answers what you need without opening anything,
// and the rows that look wrong are the ones you open.

/**
 * How many rows are shown before the rest are folded away.
 *
 * Enough that the common case — a handful of related changes — is fully visible
 * without interaction, and few enough that twenty of them do not push the
 * approve button off the screen. A card whose buttons cannot be seen is a card
 * that gets approved by scrolling.
 */
const VISIBLE_ROWS = 6;

/** Whether a child has to be read before the batch can be approved. */
export function batchChildNeedsReview(risk: AiRisk): boolean {
    return risk !== 'safe';
}

/** The children of a batch that are still unread. */
export function unreviewedBatchCalls(preview: AiBatchPreview, reviewed: ReadonlySet<number>): number {
    return preview.calls.reduce(
        (count, call, index) =>
            batchChildNeedsReview(call.risk) && !reviewed.has(index) ? count + 1 : count,
        0,
    );
}

export function BatchPreview({
    preview,
    redactions = {},
    reviewed,
    onReview,
    className,
}: {
    preview: AiBatchPreview;
    redactions?: Record<string, string>;
    /** Indices whose arguments have been shown. Owned by the card, which gates on it. */
    reviewed: ReadonlySet<number>;
    onReview: (indices: number[]) => void;
    className?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

    const hidden = preview.calls.length - VISIBLE_ROWS;
    const shown = expanded ? preview.calls : preview.calls.slice(0, VISIBLE_ROWS);

    const outstanding = useMemo(() => unreviewedBatchCalls(preview, reviewed), [preview, reviewed]);

    const toggle = (index: number) => {
        setOpen(current => {
            const next = new Set(current);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }

            return next;
        });
        onReview([index]);
    };

    // One deliberate action that puts every outstanding change on screen at
    // once. Twenty separate clicks would be reviewed less carefully, not more —
    // people would stop reading by the sixth and the control would have taught
    // them to click through it.
    const revealEverything = () => {
        const indices = preview.calls
            .map((call, index) => (batchChildNeedsReview(call.risk) ? index : -1))
            .filter(index => index !== -1);

        setExpanded(true);
        setOpen(new Set([...open, ...indices]));
        onReview(indices);
    };

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            {preview.summary && (
                <p className="text-xs leading-relaxed text-[var(--color-ink)]">
                    <span className="text-[var(--color-ink-faint)]">
                        {m['server.ai.batch.summaryLabel']()}{' '}
                    </span>
                    {preview.summary}
                </p>
            )}

            <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
                {shown.map((call, index) => (
                    // Index rather than the tool name: a batch is very often the
                    // same tool many times over, and a duplicate key would let
                    // React reuse one row's open state for another's.
                    <BatchRow
                        key={index}
                        call={call}
                        redactions={redactions}
                        open={open.has(index)}
                        reviewed={reviewed.has(index)}
                        onToggle={() => toggle(index)}
                    />
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                {hidden > 0 && !expanded && (
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="text-xs text-[var(--brand)] transition-colors hover:text-[var(--color-ink)]"
                    >
                        {m['server.ai.batch.showAll']({ count: hidden })}
                    </button>
                )}

                {outstanding > 0 && (
                    <>
                        <button
                            type="button"
                            data-ai-batch-review-all
                            onClick={revealEverything}
                            className="text-xs font-medium text-[var(--brand)] transition-colors hover:text-[var(--color-ink)]"
                        >
                            {m['server.ai.batch.reviewAll']()}
                        </button>
                        <span className="text-xs text-[var(--color-ink-muted)]" data-ai-batch-outstanding={outstanding}>
                            {m['server.ai.batch.unreviewed']({ count: outstanding })}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}

function BatchRow({
    call,
    redactions,
    open,
    reviewed,
    onToggle,
}: {
    call: AiBatchPreview['calls'][number];
    redactions: Record<string, string>;
    open: boolean;
    reviewed: boolean;
    onToggle: () => void;
}) {
    const target = toolTarget(call.tool, call.arguments);
    const needsReview = batchChildNeedsReview(call.risk);

    return (
        <div className={cn(needsReview && !reviewed && 'bg-[var(--brand-soft)]/30')}>
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]"
            >
                <ChevronRight
                    className={cn(
                        'h-3 w-3 shrink-0 text-[var(--color-ink-faint)] transition-transform',
                        open && 'rotate-90',
                    )}
                />
                <ToolIcon tool={call.tool} className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" />

                <span className="shrink-0 font-medium text-[var(--color-ink)]">{toolLabel(call.tool)}</span>

                {target && (
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-ink-muted)]">
                        {target}
                    </span>
                )}

                {call.risk === 'destructive' && (
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--color-danger)]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-danger)]">
                        {m['server.ai.approval.destructive']()}
                    </span>
                )}
            </button>

            {open && (
                <div className="border-t border-[var(--color-border)] px-2.5 py-2">
                    {/* Every row opens, including one with no arguments: "this
                        call takes none" is itself a fact worth confirming, and a
                        row that refuses to open reads as a row with something
                        behind it. */}
                    {Object.keys(call.arguments).length > 0 ? (
                        <ToolArgs args={call.arguments} redactions={redactions} />
                    ) : (
                        <p className="text-xs text-[var(--color-ink-faint)]">
                            {m['server.ai.batch.noArguments']()}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
