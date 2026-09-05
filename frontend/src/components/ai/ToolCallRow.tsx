import { useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { restoreRedactionsDeep, type ChatEntry } from '@/state/agentChat';
import { ToolArgs } from './ToolArgs';
import { ToolIcon, toolLifecycleLabel, toolTarget } from './toolMeta';

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

    // Collapsed, this is a log line rather than a card: a status LED, the verb,
    // its argument, and the outcome, all on one monospace baseline. The card it
    // used to be — a bordered rectangle filled at 40% opacity over a border at
    // 25% — was very nearly invisible, and a turn that runs twelve of them read
    // as grey mush on exactly the surface where the audit trail matters most.
    // Twelve log lines read as a log, which is what they are.
    return (
        <div className={cn(open && 'bg-[var(--color-surface-2)]/40')}>
            <button
                type="button"
                onClick={() => expandable && setOpen(o => !o)}
                disabled={!expandable}
                className={cn(
                    'flex w-full items-center gap-2.5 py-1 text-left font-mono text-[11px]',
                    expandable && 'transition-colors hover:text-[var(--color-ink)]',
                )}
            >
                <StatusLed status={entry.status} />

                <ToolIcon tool={entry.tool} className="h-3 w-3 shrink-0 text-[var(--color-ink-faint)]" />

                <span className="shrink-0 text-[var(--brand-bright)]">
                    {toolLifecycleLabel(entry.tool, entry.status)}
                </span>

                {target && (
                    <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{target}</span>
                )}
                {!target && <span className="flex-1" />}

                {entry.risk === 'destructive' && entry.status !== 'running' && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-warning)]" />
                )}

                <span
                    className={cn(
                        'flex shrink-0 items-center gap-1.5 text-[10px]',
                        entry.status === 'partial'
                            ? 'text-[var(--color-warning)]'
                            : entry.status === 'error'
                              ? 'text-[var(--color-danger)]'
                              : 'text-[var(--color-ink-faint)]',
                    )}
                >
                    {/* Only calls slow enough to be worth noticing are timed; a
                        millisecond count on every row is clutter. */}
                    {entry.durationMs !== undefined && entry.durationMs >= 1000 && (
                        <span className="tabular-nums">{(entry.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    {entry.summary && <span className="max-w-[14rem] truncate">{entry.summary}</span>}
                </span>

                <ChevronRight
                    className={cn(
                        'h-3 w-3 shrink-0 text-[var(--color-ink-faint)] transition-transform',
                        !expandable && 'invisible',
                        open && 'rotate-90',
                    )}
                />
            </button>

            {open && (
                <div className="space-y-2 border-l border-[var(--color-border-strong)] py-2 pl-3">
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
 * The outcome of a call, as one dot.
 *
 * A running call keeps its spinner — motion is the only honest way to say "still
 * going" — but a settled one does not need a glyph and a word and a colour to
 * say it worked. At this density a coloured dot in a fixed column is read
 * faster than any icon, and twelve of them form a scannable margin down the
 * left of the turn.
 */
function StatusLed({ status }: { status: ToolEntry['status'] }) {
    if (status === 'pending' || status === 'running') {
        return <Spinner className="h-3 w-3 shrink-0" />;
    }

    return (
        <span
            aria-hidden
            className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                status === 'ok'
                    ? 'bg-[var(--color-accent)]'
                    : status === 'partial'
                      ? 'bg-[var(--color-warning)]'
                      : 'bg-[var(--color-danger)]',
            )}
        />
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
