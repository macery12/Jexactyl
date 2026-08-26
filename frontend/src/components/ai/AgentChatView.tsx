import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, CircleAlert } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoreApi, UseBoundStore } from 'zustand';
import { restoreRedactions, type AgentChatState, type ChatEntry } from '@/state/agentChat';
import { ChatComposer } from './ChatComposer';
import { ChatMarkdown } from './ChatMarkdown';
import { AssistBanner } from './AssistBanner';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallRow } from './ToolCallRow';
import { ApprovalCard } from './ApprovalCard';
import { QuestionCard } from './QuestionCard';
import { QueueBanner } from './QueueBanner';
import { StatusLine } from './StatusLine';
import { SessionDetail, SessionDetailSheet, type DetailGroup } from './SessionDetail';
import { UserMessage } from './UserMessage';

// The conversation itself — transcript, composer, and the cards a turn can
// produce.
//
// Presentational and store-agnostic: both the server assistant and the admin
// assistant render this, so the entry-rendering switch and the suspension cards
// have exactly one implementation. Everything that differs between the two —
// which store, what the empty state says, what a destructive confirmation is
// typed against, which detail fields are worth showing — arrives as props.
//
// The transcript is grouped into turns rather than rendered as a flat list. A
// flat list is what made a question, the eight tool calls it caused, and the
// answer that followed all weigh the same and blur together: scroll back three
// turns and there was nothing on screen to say which work belonged to which
// question. A turn is opened by a user message and closed by the next one, which
// is the only boundary that has ever been true here.
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

/** Everything a turn can contain apart from the question that opened it. */
type TurnEntry = Exclude<ChatEntry, { kind: 'user' }>;

/** One question and everything it caused, in order. */
interface Turn {
    key: string;
    index: number;
    user: Extract<ChatEntry, { kind: 'user' }> | null;
    rest: TurnEntry[];
}

/**
 * Split a flat entry list into turns.
 *
 * A user message opens one. Anything before the first user message — which a
 * reloaded transcript can produce, and a resumed turn always does — becomes an
 * unnumbered leading turn rather than being dropped, because entries the view
 * silently discards are exactly the ones nobody notices are missing.
 */
function toTurns(entries: ChatEntry[]): Turn[] {
    const turns: Turn[] = [];
    let current: Turn | null = null;

    for (const entry of entries) {
        if (entry.kind === 'user') {
            current = {
                key: entry.key,
                index: turns.filter(turn => turn.user !== null).length + 1,
                user: entry,
                rest: [],
            };
            turns.push(current);
            continue;
        }

        if (current === null) {
            current = { key: entry.key, index: 0, user: null, rest: [] };
            turns.push(current);
        }

        current.rest.push(entry);
    }

    return turns;
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
    detail = [],
    speaker,
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
    /** Route-specific rows for the detail column. Empty hides it entirely. */
    detail?: DetailGroup[];
    /**
     * Who to credit each message to, or absent for none.
     *
     * Worth a line on the admin assistant, where several operators share a
     * session and which of them asked is real information. On a customer's own
     * server it would say "You" over and over, which is a line spent saying
     * nothing — so that route passes nothing and lets the alignment speak.
     */
    speaker?: string;
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
    const [sheetOpen, setSheetOpen] = useState(false);
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

    const turns = toTurns(entries);

    const pendingApprovals = entries.filter(
        entry => entry.kind === 'approval' && !entry.decision,
    ) as Extract<ChatEntry, { kind: 'approval' }>[];

    // Points at the card rather than deciding for it. The decision itself lives
    // on the approval — a destructive one demands the server's name typed out,
    // and a second implementation of that gate is the last thing this needs.
    const reviewPending = () => {
        const first = pendingApprovals[0];
        if (!first) return;

        following.current = false;
        document
            .getElementById(`ai-approval-${first.key}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    const showDetail = !compact && detail.some(group => group.rows.length > 0);

    const renderEntry = (entry: TurnEntry) => {
        if (entry.kind === 'reasoning') {
            return <ThinkingBlock key={entry.key} entry={entry} />;
        }

        if (entry.kind === 'notice') {
            return (
                <div
                    key={entry.key}
                    className="flex items-start gap-2 border-l-2 border-[var(--color-border-strong)] py-1.5 pl-3 text-xs text-[var(--color-ink-muted)]"
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
                <div key={entry.key} id={`ai-approval-${entry.key}`}>
                    <ApprovalCard
                        entry={entry}
                        confirmPhrase={confirmPhrase}
                        disabled={loading}
                        redactions={redactions}
                        onDecide={(decision, confirmation) => decide(entry.turnId, decision, confirmation)}
                    />
                </div>
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

        // The assistant's answer carries no avatar and no name. It does not need
        // one: the user's message is on the right, so everything on the left is
        // the assistant by position alone. The avatar circle that used to sit
        // here was the second of two different metaphors in one column — a
        // bubble for one speaker and a portrait for the other — and removing it
        // is what lets the answer read as the plain prose it is.
        return (
            <div
                key={entry.key}
                className={cn('min-w-0 text-[13.5px]', entry.error && 'text-[var(--color-danger)]')}
            >
                <ChatMarkdown content={restoreRedactions(entry.content, redactions)} />
                {entry.streaming && (
                    <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-[var(--brand)] align-text-bottom" />
                )}
            </div>
        );
    };

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                                <p className="mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
                                    {emptySubtitle}
                                </p>
                                {/* The disclaimer is stated in full exactly
                                    once, here, where somebody starting a
                                    conversation will actually read it. The
                                    status line keeps it in view afterwards, but
                                    a strip that truncates is not where a claim
                                    about what the agent may do to your server
                                    gets made for the first time. */}
                                <p className="mx-auto mt-3 max-w-md text-xs text-[var(--color-ink-faint)]">
                                    {disclaimer}
                                </p>
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
                        <div className="flex w-full flex-col">
                            {turns.map(turn => (
                                <div
                                    key={turn.key}
                                    className={cn(
                                        'grid border-b border-[var(--color-border)] py-3 pr-4 last:border-b-0',
                                        compact
                                            ? 'grid-cols-[2.25rem_minmax(0,1fr)]'
                                            : 'grid-cols-[3.25rem_minmax(0,1fr)]',
                                    )}
                                >
                                    {/* The gutter is what makes a turn a turn.
                                        It carries the index and, for a turn sent
                                        in this session, the time — hairline on
                                        its right so a long turn's steps stay
                                        visibly tied to the question above. */}
                                    <div className="border-r border-[var(--color-border)] pr-2.5 text-right font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.06em] text-[var(--color-ink-faint)]">
                                        {turn.index > 0 && (
                                            <div className="tabular-nums">
                                                {compact
                                                    ? `T${String(turn.index).padStart(2, '0')}`
                                                    : m['server.ai.turn.index']({
                                                          index: String(turn.index).padStart(2, '0'),
                                                      })}
                                            </div>
                                        )}
                                        {turn.user?.at !== undefined && (
                                            <div className="tabular-nums opacity-70">
                                                {new Date(turn.user.at).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex min-w-0 flex-col gap-2 pl-3.5">
                                        {turn.user && (
                                            <UserMessage content={turn.user.content} speaker={speaker} />
                                        )}
                                        {turn.rest.map(renderEntry)}
                                    </div>
                                </div>
                            ))}

                            {queue && (
                                <div className="px-4 py-3">
                                    <QueueBanner queue={queue} />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {assist && (
                    <div className="shrink-0 px-4 pb-2">
                        <AssistBanner session={assist} onEnd={onEndAssist} />
                    </div>
                )}

                {header && <div className="shrink-0 px-4 pb-1">{header}</div>}

                <ChatComposer
                    ref={composerRef}
                    value={input}
                    onChange={setInput}
                    onSend={submit}
                    onCancel={cancel}
                    loading={loading}
                    placeholder={placeholder}
                />

                <StatusLine
                    loading={loading}
                    queue={queue}
                    activity={activity}
                    step={step}
                    slowHint={slowHint}
                    pending={pendingApprovals.length}
                    trailing={disclaimer}
                />

                {/* Below the breakpoint the same rows re-anchor as a sheet. A
                    vertical stack of key/value pairs is the one shape that moves
                    between a right column and a bottom sheet without being
                    redrawn, which is why this layout survives a phone at all. */}
                {showDetail && (
                    <div className="lg:hidden">
                        <SessionDetailSheet
                            groups={detail}
                            pending={pendingApprovals.length}
                            open={sheetOpen}
                            onToggle={() => setSheetOpen(open => !open)}
                            onReviewPending={reviewPending}
                        />
                    </div>
                )}
            </div>

            {showDetail && (
                <SessionDetail
                    groups={detail}
                    pending={pendingApprovals.length}
                    onReviewPending={reviewPending}
                    className="hidden w-[12.375rem] shrink-0 border-l border-[var(--color-border-strong)] lg:flex"
                />
            )}
        </div>
    );
}
