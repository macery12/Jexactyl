import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AgentChatState } from '@/state/agentChat';
import type { AiDiffPreview, AiRisk } from '@/lib/aiStream';
import { ChatComposer } from './ChatComposer';
import { ChatMarkdown } from './ChatMarkdown';
import { ToolCallRow } from './ToolCallRow';
import { ApprovalCard } from './ApprovalCard';
import { QuestionCard } from './QuestionCard';
import { QueueBanner } from './QueueBanner';
import { PendingBanner, type PendingSummary } from './PendingBanner';

// The conversation itself — transcript, composer, and the cards a turn can
// produce.
//
// Presentational and store-agnostic: both the server assistant and the admin
// assistant render this, so the entry-rendering switch and the suspension cards
// have exactly one implementation. Everything that differs between the two —
// which store, what the empty state says, what a destructive confirmation is
// typed against — arrives as props.

export interface OrphanedPending extends PendingSummary {
    arguments: Record<string, unknown>;
    risk: AiRisk;
    preview?: AiDiffPreview | null;
}

export function AgentChatView({
    store: useStore,
    compact = false,
    confirmPhrase,
    emptyTitle,
    emptySubtitle,
    placeholder,
    disclaimer,
    suggestions = [],
    orphaned = [],
    header,
}: {
    store: UseBoundStore<StoreApi<AgentChatState>>;
    compact?: boolean;
    /** What a destructive approval must be typed against. */
    confirmPhrase: string;
    emptyTitle: string;
    emptySubtitle: string;
    placeholder: string;
    disclaimer: string;
    suggestions?: string[];
    orphaned?: OrphanedPending[];
    /** Rendered on the composer's left, above the input. */
    header?: ReactNode;
}) {
    const entries = useStore(s => s.entries);
    const loading = useStore(s => s.loading);
    const queue = useStore(s => s.queue);
    const step = useStore(s => s.step);
    const slowHint = useStore(s => s.slowHint);
    const send = useStore(s => s.send);
    const cancel = useStore(s => s.cancel);
    const decide = useStore(s => s.decide);
    const answer = useStore(s => s.answer);
    const restorePending = useStore(s => s.restorePending);

    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [entries, queue]);

    // Not wrapped in useCallback: the React Compiler memoizes it, and a manual
    // memo here infers different dependencies than the ones written down, which
    // makes it skip optimizing the component entirely.
    const submit = () => {
        send(input);
        setInput('');
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                {entries.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                            <Bot className="h-7 w-7 text-[var(--brand)]" />
                        </div>
                        <div>
                            <p className="text-lg font-semibold text-[var(--color-ink)]">{emptyTitle}</p>
                            <p className="mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">{emptySubtitle}</p>
                        </div>
                        {!compact && suggestions.length > 0 && (
                            <div className="flex max-w-lg flex-wrap justify-center gap-2">
                                {suggestions.map(text => (
                                    <button
                                        key={text}
                                        type="button"
                                        onClick={() => !loading && send(text)}
                                        className="rounded-full border border-[var(--color-border-strong)] px-3.5 py-1.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)] hover:text-[var(--color-ink)]"
                                    >
                                        {text}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div
                        className={cn(
                            'mx-auto flex w-full flex-col gap-4 px-4 py-5',
                            compact ? 'max-w-none' : 'max-w-3xl',
                        )}
                    >
                        {entries.map(entry => {
                            if (entry.kind === 'user') {
                                return (
                                    <div key={entry.key} className="flex justify-end">
                                        <div
                                            className="max-w-[85%] whitespace-pre-wrap break-words bg-[var(--color-surface-2)] px-4 py-2.5 text-sm leading-relaxed text-[var(--color-ink)]"
                                            style={{ borderRadius: 'var(--radius-card)' }}
                                        >
                                            {entry.content}
                                        </div>
                                    </div>
                                );
                            }

                            if (entry.kind === 'tool') {
                                return <ToolCallRow key={entry.key} entry={entry} />;
                            }

                            if (entry.kind === 'approval') {
                                return (
                                    <ApprovalCard
                                        key={entry.key}
                                        entry={entry}
                                        confirmPhrase={confirmPhrase}
                                        disabled={loading}
                                        onDecide={(decision, confirmation) =>
                                            decide(entry.turnId, decision, confirmation)
                                        }
                                    />
                                );
                            }

                            if (entry.kind === 'question') {
                                return (
                                    <QuestionCard
                                        key={entry.key}
                                        entry={entry}
                                        disabled={loading}
                                        onAnswer={value => answer(entry.turnId, value)}
                                        onDismiss={() => decide(entry.turnId, 'reject')}
                                    />
                                );
                            }

                            return (
                                <div key={entry.key} className="group flex gap-3">
                                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)]">
                                        <Bot className="h-4 w-4 text-[var(--brand)]" />
                                    </div>
                                    <div
                                        className={cn(
                                            'min-w-0 flex-1',
                                            entry.error && 'text-[var(--color-danger)]',
                                        )}
                                    >
                                        <ChatMarkdown content={entry.content} />
                                        {entry.streaming && (
                                            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-[var(--brand)] align-text-bottom" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {queue && <QueueBanner queue={queue} />}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            <div className="shrink-0 px-4 pb-3 pt-1">
                <div className={cn('mx-auto w-full', compact ? 'max-w-none' : 'max-w-3xl')}>
                    {orphaned.length > 0 && (
                        <div className="mb-2 flex flex-col gap-2">
                            {orphaned.map(action => (
                                <PendingBanner
                                    key={action.turn_id}
                                    action={action}
                                    onReview={() =>
                                        restorePending({
                                            turnId: action.turn_id,
                                            tool: action.tool,
                                            args: action.arguments,
                                            risk: action.risk,
                                            preview: action.preview ?? null,
                                        })
                                    }
                                />
                            ))}
                        </div>
                    )}

                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        {header ?? <span />}

                        <span className="truncate text-xs text-[var(--color-ink-faint)]">
                            {loading && step
                                ? m['server.ai.stepOf']({ step: step.step, total: step.maxSteps })
                                : slowHint
                                  ? m['server.ai.slowHint']()
                                  : ''}
                        </span>
                    </div>

                    <ChatComposer
                        ref={composerRef}
                        value={input}
                        onChange={setInput}
                        onSend={submit}
                        onCancel={cancel}
                        loading={loading}
                        placeholder={placeholder}
                    />

                    <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-faint)]">{disclaimer}</p>
                </div>
            </div>
        </div>
    );
}

/**
 * Which pending actions have no card on screen already.
 *
 * A turn that suspended in this session still has its card; one from a previous
 * visit does not, and would otherwise expire unseen.
 */
export function orphanedPending<T extends { turn_id: string }>(
    pending: T[],
    entries: AgentChatState['entries'],
): T[] {
    const open = new Set(
        entries
            .filter(entry => (entry.kind === 'approval' && !entry.decision) || (entry.kind === 'question' && !entry.answer && !entry.dismissed))
            .map(entry => (entry.kind === 'approval' || entry.kind === 'question' ? entry.turnId : '')),
    );

    return pending.filter(action => !open.has(action.turn_id));
}
