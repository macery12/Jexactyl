import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import type { AiBatchPreview } from '@/lib/aiStream';
import { ToolArgs } from './ToolArgs';
import { ToolIcon, toolLabel, toolTarget } from './toolMeta';

// The calls a batch will make, before any of them run.
//
// This is the whole feature as far as the user is concerned. A batch exists so
// that twenty product creations are one decision rather than twenty, and that
// only holds if the one decision is actually informed — otherwise it is
// auto-approval with a click attached. So the rule here is that nothing is
// hidden, only folded: every call is listed, and every argument of every call is
// one click away in the same layout a single-call card uses.
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

export function BatchPreview({
    preview,
    redactions = {},
    className,
}: {
    preview: AiBatchPreview;
    redactions?: Record<string, string>;
    className?: string;
}) {
    const [expanded, setExpanded] = useState(false);

    const hidden = preview.calls.length - VISIBLE_ROWS;
    const shown = expanded ? preview.calls : preview.calls.slice(0, VISIBLE_ROWS);

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            {preview.summary && (
                <p className="text-xs leading-relaxed text-[var(--color-ink)]">{preview.summary}</p>
            )}

            <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
                {shown.map((call, index) => (
                    // Index rather than the tool name: a batch is very often the
                    // same tool many times over, and a duplicate key would let
                    // React reuse one row's open state for another's.
                    <BatchRow key={index} call={call} redactions={redactions} />
                ))}
            </div>

            {hidden > 0 && !expanded && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="self-start text-xs text-[var(--brand)] transition-colors hover:text-[var(--color-ink)]"
                >
                    {m['server.ai.batch.showAll']({ count: hidden })}
                </button>
            )}
        </div>
    );
}

function BatchRow({
    call,
    redactions,
}: {
    call: AiBatchPreview['calls'][number];
    redactions: Record<string, string>;
}) {
    const [open, setOpen] = useState(false);

    const target = toolTarget(call.tool, call.arguments);
    const expandable = Object.keys(call.arguments).length > 0;

    return (
        <div>
            <button
                type="button"
                onClick={() => expandable && setOpen(o => !o)}
                disabled={!expandable}
                className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                    expandable && 'transition-colors hover:bg-[var(--color-surface-2)]',
                )}
            >
                <ChevronRight
                    className={cn(
                        'h-3 w-3 shrink-0 text-[var(--color-ink-faint)] transition-transform',
                        !expandable && 'invisible',
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
            </button>

            {open && (
                <div className="border-t border-[var(--color-border)] px-2.5 py-2">
                    <ToolArgs args={call.arguments} redactions={redactions} />
                </div>
            )}
        </div>
    );
}
