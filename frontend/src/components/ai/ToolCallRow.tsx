import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleAlert, X } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { restoreRedactionsDeep, type ChatEntry } from '@/state/agentChat';
import { ToolArgs } from './ToolArgs';
import { ToolIcon, toolLabel, toolTarget } from './toolMeta';

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>;

// One tool step, as a single line.
//
// A turn can run twelve of these, so the collapsed form has to stay scannable:
// verb, target, outcome. Everything else — the arguments sent and the payload
// that came back — is one click away rather than on screen by default.
//
// The result is worth showing because the assistant's account of a tool call is
// a summary of something the user never sees; being able to open the evidence
// behind a claim is the difference between trusting it and checking it. It is
// held in the store for this session only, so a reloaded transcript shows the
// row without it.
export function ToolCallRow({
    entry,
    redactions = {},
}: {
    entry: ToolEntry;
    /**
     * Token => real value. The payload shown here is what the *model* received,
     * so it holds tokens; the person reading is entitled to the values behind
     * them, and seeing both is what makes the redaction legible rather than
     * mysterious.
     */
    redactions?: Record<string, string>;
}) {
    const [open, setOpen] = useState(false);

    const target = toolTarget(entry.tool, entry.args);
    const hasArgs = Object.keys(entry.args).length > 0;
    const hasResult = entry.result !== undefined && entry.result !== null;
    const expandable = hasArgs || hasResult;

    return (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
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
                <ToolIcon tool={entry.tool} className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" />

                <span className="shrink-0 font-medium text-[var(--color-ink)]">{toolLabel(entry.tool)}</span>

                {target && (
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-ink-muted)]">
                        {target}
                    </span>
                )}
                {!target && <span className="flex-1" />}

                {entry.risk === 'destructive' && entry.status !== 'running' && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                )}

                {entry.status === 'pending' || entry.status === 'running' ? (
                    <Spinner className="h-3.5 w-3.5 shrink-0" />
                ) : (
                    <span
                        className={cn(
                            'flex shrink-0 items-center gap-1 text-[11px]',
                            entry.status === 'ok'
                                ? 'text-[var(--color-ink-faint)]'
                                : entry.status === 'partial'
                                  ? 'text-[var(--color-warning)]'
                                  : 'text-[var(--color-danger)]',
                        )}
                    >
                        {/* Only calls slow enough to be worth noticing are
                            timed; a millisecond count on every row is clutter. */}
                        {entry.durationMs !== undefined && entry.durationMs >= 1000 && (
                            <span className="font-mono tabular-nums text-[var(--color-ink-faint)]">
                                {(entry.durationMs / 1000).toFixed(1)}s
                            </span>
                        )}
                        {entry.summary && <span className="max-w-[16rem] truncate">{entry.summary}</span>}
                        {entry.status === 'ok' ? (
                            <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                        ) : entry.status === 'partial' ? (
                            <CircleAlert className="h-3.5 w-3.5" />
                        ) : (
                            <X className="h-3.5 w-3.5" />
                        )}
                    </span>
                )}
            </button>

            {open && (
                <div className="space-y-2 border-t border-[var(--color-border)] px-2.5 py-2">
                    {hasArgs && (
                        <div>
                            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                                {m['server.ai.tool.arguments']()}
                            </p>
                            {/* Laid out rather than dumped as JSON: what was
                                asked for is a question about intent, and reads
                                as one. The result below stays raw, because that
                                panel exists to show exactly what the model was
                                given. */}
                            <ToolArgs args={entry.args} redactions={redactions} />
                        </div>
                    )}
                    {hasResult && (
                        <Payload
                            label={m['server.ai.tool.result']()}
                            value={restoreRedactionsDeep(entry.result, redactions)}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * A labelled JSON block.
 *
 * Capped in height rather than truncated: the backend already trims a result to
 * the model's budget, so what arrives here is bounded, and cutting it again
 * would hide exactly the row someone opened this to find.
 */
function Payload({ label, value }: { label: string; value: unknown }) {
    return (
        <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                {label}
            </p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                {stringify(value)}
            </pre>
        </div>
    );
}

function stringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        // Circular structures cannot reach here over JSON, but a shaper is free
        // to return anything and a thrown error would take the transcript down.
        return String(value);
    }
}
