import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, CircleAlert } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoreApi, UseBoundStore } from 'zustand';
import { restoreRedactions, type AgentChatState } from '@/state/agentChat';
import { ChatComposer } from './ChatComposer';
import { ChatMarkdown } from './ChatMarkdown';
import { ActivityRow } from './ActivityRow';
import { AssistBanner } from './AssistBanner';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallRow } from './ToolCallRow';
import { ApprovalCard } from './ApprovalCard';
import { QuestionCard } from './QuestionCard';
import { QueueBanner } from './QueueBanner';

// The conversation itself — transcript, composer, and the cards a turn can
// produce.
//
// Presentational and store-agnostic: both the server assistant and the admin
// assistant render this, so the entry-rendering switch and the suspension cards
// have exactly one implementation. Everything that differs between the two —
// which store, what the empty state says, what a destructive confirmation is
// typed against — arrives as props.
//
// It used to carry a banner above the composer for an approval left unanswered
// on a previous visit, rebuilt from a poll of the pending endpoint. It is gone:
// an approval that is still on screen already has its card, and one that is not
// belongs to a turn nobody came back to — so the banner spent its life
// announcing a decision that had already been abandoned. `ask_user` made that
// plain, since a question is not an approval and the banner said it was.
// Anything genuinely unresolved expires on its own within the half hour.

/**
 * How far off the bottom still counts as following the conversation.
 *
 * Not zero, for two reasons. A streaming answer grows under the reader's
 * scroll position between the append and the effect that chases it, so an exact
 * comparison would read its own output as the user having scrolled away. And a
 * few pixels of drift — a trackpad nudge, a rounded sub-pixel height — is not
 * someone asking to stop following.
 */
const FOLLOW_SLACK = 48;

export function AgentChatView({
    store: useStore,
    compact = false,
    confirmPhrase,
    emptyTitle,
    emptySubtitle,
    placeholder,
    disclaimer,
    suggestions = [],
    header,
    onEndAssist,
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
    /** Rendered on the composer's left, above the input. */
    header?: ReactNode;
    /** Close an open assist session. Absent on surfaces that cannot open one. */
    onEndAssist?: () => void;
}) {
    const entries = useStore(s => s.entries);
    const loading = useStore(s => s.loading);
    const queue = useStore(s => s.queue);
    const step = useStore(s => s.step);
    const activity = useStore(s => s.activity);
    const redactions = useStore(s => s.redactions);
    const assist = useStore(s => s.assist);
    const slowHint = useStore(s => s.slowHint);
    const send = useStore(s => s.send);
    const cancel = useStore(s => s.cancel);
    const decide = useStore(s => s.decide);
    const answer = useStore(s => s.answer);

    const [input, setInput] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);

    // Whether the reader is still following the bottom of the transcript. A ref
    // rather than state: it changes on every scroll event and nothing renders
    // differently for it, so putting it in state would re-render the whole
    // transcript on each wheel tick.
    const following = useRef(true);

    // Distance from the bottom, within a tolerance. Answered on the scroll event
    // rather than in the effect, so the reader's position is read before the
    // next append moves it.
    const atBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;

    useEffect(() => {
        const el = scrollRef.current;

        // Only when the reader was already at the bottom. Scrolling up is a
        // deliberate act — usually to re-read a tool result while the answer is
        // still being written — and yanking them back down mid-sentence makes a
        // streaming answer impossible to read at all.
        if (!el || !following.current) return;

        // The container, not `scrollIntoView`. That scrolls *every* scrollable
        // ancestor to bring the element into view, including the document, so a
        // chat streaming inside the page dragged the whole window down with it.
        el.scrollTop = el.scrollHeight;
    }, [entries, queue, activity?.phase]);

    // Not wrapped in useCallback: the React Compiler memoizes it, and a manual
    // memo here infers different dependencies than the ones written down, which
    // makes it skip optimizing the component entirely.
    const submit = () => {
        // Sending is an explicit "I am at the bottom now", whatever was being
        // read a moment ago — the reply belongs under the question.
        following.current = true;
        send(input);
        setInput('');
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div
                ref={scrollRef}
                onScroll={event => {
                    following.current = atBottom(event.currentTarget);
                }}
                className="min-h-0 flex-1 overflow-y-auto"
            >
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

                            if (entry.kind === 'reasoning') {
                                return <ThinkingBlock key={entry.key} entry={entry} />;
                            }

                            if (entry.kind === 'notice') {
                                return (
                                    <div
                                        key={entry.key}
                                        className="flex items-start gap-2 border-l-2 border-[var(--color-border-strong)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
                                    >
                                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                                        <span>{entry.content}</span>
                                    </div>
                                );
                            }

                            if (entry.kind === 'tool') {
                                return <ToolCallRow key={entry.key} entry={entry} redactions={redactions} />;
                            }

                            if (entry.kind === 'approval') {
                                return (
                                    <ApprovalCard
                                        key={entry.key}
                                        entry={entry}
                                        confirmPhrase={confirmPhrase}
                                        disabled={loading}
                                        redactions={redactions}
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
                                        <ChatMarkdown content={restoreRedactions(entry.content, redactions)} />
                                        {entry.streaming && (
                                            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-[var(--brand)] align-text-bottom" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {queue ? (
                            <QueueBanner queue={queue} />
                        ) : (
                            // Suppressed while prose is streaming: the caret in
                            // the bubble already says the same thing, and two
                            // live indicators reading differently is worse than
                            // one. The queue banner outranks it outright — a
                            // turn that has not started is not working yet.
                            loading && activity && activity.phase !== 'writing' && (
                                <ActivityRow activity={activity} />
                            )
                        )}
                    </div>
                )}
            </div>

            <div className="shrink-0 px-4 pb-3 pt-1">
                <div className={cn('mx-auto w-full', compact ? 'max-w-none' : 'max-w-3xl')}>
                    {assist && (
                        <div className="mb-2">
                            <AssistBanner session={assist} onEnd={onEndAssist} />
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
