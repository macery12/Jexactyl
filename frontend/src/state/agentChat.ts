import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { m } from '@/i18n';
import type { AgentEvent, AgentStreamCallbacks, AiApprovalPreview, AiRisk } from '@/lib/aiStream';
import { streamAgentDecision, streamAgentTurn, type StoredMessage } from '@/api/ai';
import { streamAdminAgentDecision, streamAdminAgentTurn } from '@/api/adminAi';

// One conversation per surface, shared by every component that renders it.
//
// Chat state lives in a store rather than in a component because a turn can run
// for minutes and must survive the user navigating away — the whole point of
// the drawer is to ask a question while you work somewhere else.
//
// Built as a factory rather than a singleton because there are now two surfaces:
// a server's own assistant and the admin assistant. They share every behaviour
// except which endpoints a turn is sent to, which is what the adapter supplies.
// Keeping the abort controller and timers inside the factory closure is not
// incidental tidying — as module state they would be shared between the two
// stores, so opening the admin assistant would silently abort a running server
// turn in the dock drawer.

export interface QuestionOption {
    label: string;
    description?: string;
}

export type ChatEntry =
    | { kind: 'user'; key: string; content: string }
    | { kind: 'assistant'; key: string; content: string; streaming?: boolean; error?: boolean }
    /**
     * Why the turn stopped, when it stopped for a reason that is not an answer.
     *
     * Its own kind rather than an error bubble: hitting the step ceiling is a
     * boundary working as designed, not a fault, and styling it as a failure
     * would teach people to distrust a limit that is protecting them. What it
     * must not do is stay silent — a turn that gives up looks exactly like a
     * turn that finished, and that is the difference between an assistant that
     * ran out of room and one that is simply unreliable.
     */
    | { kind: 'notice'; key: string; content: string }
    | {
          kind: 'reasoning';
          key: string;
          content: string;
          streaming?: boolean;
          /** When the block opened, so its duration can be fixed as it closes. */
          startedAt: number;
          seconds?: number;
      }
    | {
          kind: 'tool';
          key: string;
          callId: string;
          tool: string;
          args: Record<string, unknown>;
          risk: AiRisk;
          status: 'pending' | 'running' | 'ok' | 'error';
          summary?: string;
          /** The shaped payload the model received. Session-only; a reloaded transcript has none. */
          result?: unknown;
          durationMs?: number;
      }
    | {
          kind: 'approval';
          key: string;
          turnId: string;
          tool: string;
          args: Record<string, unknown>;
          risk: AiRisk;
          preview: AiApprovalPreview | null;
          decision?: 'approved' | 'rejected';
      }
    | {
          kind: 'question';
          key: string;
          turnId: string;
          question: string;
          options: QuestionOption[];
          allowOther: boolean;
          answer?: string;
          dismissed?: boolean;
      };

export interface QueuePosition {
    position: number;
    ahead: number;
    etaSeconds: number;
}

/**
 * What the turn is doing right now, for the live row at the foot of the
 * transcript.
 *
 * `waiting` covers the stretch between sending and the model's first token,
 * which is where an agent looks most like it has hung. `startedAt` is what the
 * row counts up from — a wait is only unnerving when you cannot see it being
 * measured.
 */
export interface Activity {
    phase: 'waiting' | 'reasoning' | 'writing' | 'calling' | 'running';
    /** The tool being named or run, for the phases that have one. */
    tool?: string;
    startedAt: number;
}

/**
 * The audited session this conversation has open on a customer's server.
 *
 * Held as state rather than as a transcript entry because it is a standing fact
 * about the conversation, not a thing that happened in it: once it is open,
 * every row below it is a row about somebody else's server, and that should be
 * visible without scrolling back to find the moment it started.
 */
export interface AssistSession {
    serverUuid: string;
    serverName: string;
    writable: boolean;
    reason: string;
}

export type AgentDecision = 'approve' | 'reject' | 'answer';

export interface AgentTurnBody {
    query: string;
    conversationId: number | null;
    console?: string | null;
}

export interface AgentDecisionBody {
    turnId: string;
    decision: AgentDecision;
    confirmation?: string;
    answer?: string;
}

/**
 * Everything that differs between the two surfaces.
 *
 * `target` is the server uuid for a server chat and an opaque marker for the
 * admin one; it is passed straight back to the adapter, which is the only thing
 * that knows what to do with it.
 */
export interface AgentChatAdapter {
    startTurn: (
        target: string,
        body: AgentTurnBody,
        callbacks: AgentStreamCallbacks,
        signal: AbortSignal,
    ) => void;
    decide: (
        target: string,
        body: AgentDecisionBody,
        callbacks: AgentStreamCallbacks,
        signal: AbortSignal,
    ) => void;
}

export interface AgentChatState {
    target: string | null;
    conversationId: number | null;
    entries: ChatEntry[];
    loading: boolean;
    queue: QueuePosition | null;
    step: { step: number; maxSteps: number } | null;
    activity: Activity | null;
    slowHint: boolean;
    drawerOpen: boolean;
    /**
     * token => the real value it stands for, for the personal data that was kept
     * out of the model's request. Resolved at render time rather than folded
     * into the entries, so one map serves prose, tool arguments and payloads
     * alike and a token that arrives after the text it appears in still lands.
     */
    redactions: Record<string, string>;
    assist: AssistSession | null;

    bind: (target: string) => void;
    setDrawer: (open: boolean) => void;
    toggleDrawer: () => void;

    newChat: () => void;
    loadTranscript: (
        conversationId: number,
        messages: StoredMessage[],
        redactions?: Record<string, string>,
    ) => void;
    loadFailed: () => void;
    /**
     * Set or clear the assist banner from outside a turn — restoring one when a
     * transcript is opened, or taking it down when the session is ended.
     */
    setAssist: (session: AssistSession | null) => void;

    send: (query: string, consoleBuffer?: string | null) => void;
    decide: (turnId: string, decision: 'approve' | 'reject', confirmation?: string) => void;
    answer: (turnId: string, value: string) => void;
    cancel: () => void;
}

// No token arriving within this window means a cold model load, not a hang.
const SLOW_HINT_MS = 5000;

/**
 * How long the stream may go completely silent before the turn is abandoned.
 *
 * Not a turn timeout — the backend owns those, and it has three (steps, wall
 * clock, and a ceiling on any single tool call). This catches the case those
 * cannot see: a connection that died without telling anyone. A slept laptop, a
 * proxy that dropped an idle stream, a worker killed mid-turn. `fetch` does not
 * reject for any of them; the reader simply never yields again, and the composer
 * stays locked behind a spinner for as long as the tab is open.
 *
 * Sized well above any legitimate gap rather than tuned close to one. The
 * longest silence a healthy turn can produce is one tool call, which the backend
 * now caps at 90 seconds, so anything approaching this is not slow — it is gone.
 */
const STALL_MS = 300_000;

// Entry keys only have to be unique within a store, but a shared counter keeps
// them unique across both, which makes them safe to log and compare.
let sequence = 0;
const nextKey = () => `e${++sequence}`;

export function createAgentChatStore(
    adapter: AgentChatAdapter,
    initialTarget: string | null = null,
): UseBoundStore<StoreApi<AgentChatState>> {
    let controller: AbortController | null = null;
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSlowTimer = () => {
        if (slowTimer) clearTimeout(slowTimer);
        slowTimer = null;
    };

    const clearStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = null;
    };

    return create<AgentChatState>((set, get) => {
        /** Replace the tail entry when it matches a predicate. */
        const patchLast = (match: (entry: ChatEntry) => boolean, patch: (entry: ChatEntry) => ChatEntry) => {
            set(state => {
                const index = state.entries.length - 1;
                const last = state.entries[index];
                if (!last || !match(last)) return state;

                const entries = [...state.entries];
                entries[index] = patch(last);
                return { entries };
            });
        };

        /**
         * Close every open streaming block.
         *
         * Every kind is swept rather than just the tail, because a step can emit
         * reasoning and then prose: by the time the answer bubble opens, the
         * reasoning block is no longer last but is still marked streaming, and
         * would otherwise pulse a caret forever.
         *
         * An assistant bubble that received nothing is dropped; a reasoning block
         * is kept regardless, since how long the model thought is worth showing
         * even when the thought itself was brief.
         */
        const sealAssistant = () => {
            set(state => {
                if (!state.entries.some(e => (e.kind === 'assistant' || e.kind === 'reasoning') && e.streaming)) {
                    return state;
                }

                const entries: ChatEntry[] = [];

                for (const entry of state.entries) {
                    if (entry.kind === 'reasoning' && entry.streaming) {
                        entries.push({
                            ...entry,
                            streaming: false,
                            seconds: Math.max(1, Math.round((Date.now() - entry.startedAt) / 1000)),
                        });
                    } else if (entry.kind === 'assistant' && entry.streaming) {
                        if (entry.content.trim() !== '') entries.push({ ...entry, streaming: false });
                    } else {
                        entries.push(entry);
                    }
                }

                return { entries };
            });
        };

        /** Append a delta to the open block of `kind`, opening one if needed. */
        const appendDelta = (kind: 'assistant' | 'reasoning', delta: string) => {
            clearSlowTimer();
            set(state => {
                const entries = [...state.entries];
                const index = entries.length - 1;
                const last = entries[index];

                if (last?.kind === kind && last.streaming) {
                    entries[index] = { ...last, content: last.content + delta };

                    return { entries, slowHint: false };
                }

                // Switching channel closes whatever was open, so an interleaved
                // step reads top to bottom rather than growing in two places.
                const closed: ChatEntry[] = entries.map(entry => {
                    if (entry.kind === 'reasoning' && entry.streaming) {
                        return {
                            ...entry,
                            streaming: false,
                            seconds: Math.max(1, Math.round((Date.now() - entry.startedAt) / 1000)),
                        };
                    }
                    if (entry.kind === 'assistant' && entry.streaming) {
                        return { ...entry, streaming: false };
                    }

                    return entry;
                });

                closed.push(
                    kind === 'reasoning'
                        ? { kind, key: nextKey(), content: delta, streaming: true, startedAt: Date.now() }
                        : { kind, key: nextKey(), content: delta, streaming: true },
                );

                return {
                    entries: closed,
                    slowHint: false,
                    activity: {
                        phase: kind === 'reasoning' ? 'reasoning' : 'writing',
                        startedAt: Date.now(),
                    },
                };
            });
        };

        const appendText = (delta: string) => appendDelta('assistant', delta);

        /**
         * Close every tool row still spinning.
         *
         * A row goes to `running` when the call is announced and leaves it when
         * its result arrives — so any path that ends a turn without one strands
         * it, and a stranded row is indistinguishable from work still in
         * progress. That is the spinner that never stops: not a tool taking a
         * long time, a tool whose answer is never coming.
         *
         * There are more of those paths than there look to be. A stream that
         * errors mid-call, a cancel, a declined approval, a tool that stopped
         * being available while the approval sat on screen — none of them emit a
         * result, and each one used to leave the row turning. Sealing here rather
         * than at each site means the next path nobody thought of is covered too.
         */
        const sealTools = (summary: string) => {
            set(state => {
                const open = (entry: ChatEntry) =>
                    entry.kind === 'tool' && (entry.status === 'running' || entry.status === 'pending');

                if (!state.entries.some(open)) return state;

                return {
                    entries: state.entries.map(entry =>
                        open(entry) ? { ...entry, status: 'error' as const, summary } : entry,
                    ),
                };
            });
        };

        const settle = () => {
            clearSlowTimer();
            clearStallTimer();
            controller = null;
            sealAssistant();
            sealTools(m['server.ai.tool.noResult']());
            set({ loading: false, queue: null, step: null, activity: null, slowHint: false });
        };

        const fail = (message: string) => {
            clearSlowTimer();
            clearStallTimer();
            controller = null;
            sealAssistant();
            sealTools(m['server.ai.tool.noResult']());
            set(state => ({
                loading: false,
                queue: null,
                step: null,
                activity: null,
                slowHint: false,
                entries: [...state.entries, { kind: 'assistant', key: nextKey(), content: message, error: true }],
            }));
        };

        /**
         * A suspension leaves the composer free but the turn alive.
         *
         * Tool rows are deliberately left spinning: the call this suspended on
         * has not failed, it is waiting on the card directly below it, and the
         * result still arrives on the resume stream under the same id.
         */
        const suspend = () => {
            clearSlowTimer();
            clearStallTimer();
            controller = null;
            set({ loading: false, queue: null, step: null, activity: null, slowHint: false });
        };

        const handleEvent = (event: AgentEvent) => {
            switch (event.type) {
                case 'conversation':
                    set({ conversationId: event.id });
                    break;

                case 'queued':
                    set({ queue: { position: event.position, ahead: event.ahead, etaSeconds: event.eta_seconds } });
                    break;

                case 'step':
                    set({
                        queue: null,
                        step: { step: event.step, maxSteps: event.max_steps },
                        activity: { phase: 'waiting', startedAt: Date.now() },
                    });
                    break;

                case 'text':
                    appendText(event.content);
                    break;

                case 'reasoning':
                    appendDelta('reasoning', event.content);
                    break;

                // The model has named a call but is still writing its arguments.
                // The row goes up now so the wait has something attached to it.
                case 'tool_pending':
                    clearSlowTimer();
                    sealAssistant();
                    set(state =>
                        state.entries.some(e => e.kind === 'tool' && e.callId === event.id)
                            ? state
                            : {
                                  slowHint: false,
                                  activity: { phase: 'calling', tool: event.tool, startedAt: Date.now() },
                                  entries: [
                                      ...state.entries,
                                      {
                                          kind: 'tool',
                                          key: nextKey(),
                                          callId: event.id,
                                          tool: event.tool,
                                          args: {},
                                          risk: 'safe',
                                          status: 'pending',
                                      },
                                  ],
                              },
                    );
                    break;

                case 'tool_call':
                    clearSlowTimer();
                    sealAssistant();
                    set(state => {
                        // Usually an upgrade of the row `tool_pending` already
                        // put up. Providers that emit calls whole never send
                        // that event, so the row is created here instead.
                        const announced = state.entries.some(e => e.kind === 'tool' && e.callId === event.id);

                        return {
                            slowHint: false,
                            activity: { phase: 'running', tool: event.tool, startedAt: Date.now() },
                            entries: announced
                                ? state.entries.map(entry =>
                                      entry.kind === 'tool' && entry.callId === event.id
                                          ? {
                                                ...entry,
                                                args: event.arguments,
                                                risk: event.risk,
                                                status: 'running',
                                            }
                                          : entry,
                                  )
                                : [
                                      ...state.entries,
                                      {
                                          kind: 'tool',
                                          key: nextKey(),
                                          callId: event.id,
                                          tool: event.tool,
                                          args: event.arguments,
                                          risk: event.risk,
                                          status: 'running',
                                      },
                                  ],
                        };
                    });
                    break;

                case 'tool_result':
                    set(state => ({
                        activity: { phase: 'waiting', startedAt: Date.now() },
                        entries: state.entries.map(entry =>
                            entry.kind === 'tool' &&
                            entry.callId === event.id &&
                            (entry.status === 'running' || entry.status === 'pending')
                                ? {
                                      ...entry,
                                      status: event.ok ? 'ok' : 'error',
                                      summary: event.summary,
                                      result: event.result,
                                      durationMs: event.duration_ms,
                                  }
                                : entry,
                        ),
                    }));
                    break;

                case 'approval_required':
                    sealAssistant();
                    set(state => ({
                        // The turn has suspended server-side. Nothing more arrives
                        // until the user decides, so the composer is released.
                        loading: false,
                        step: null,
                        activity: null,
                        entries: [
                            ...state.entries,
                            {
                                kind: 'approval',
                                key: nextKey(),
                                turnId: event.turn_id,
                                tool: event.tool,
                                args: event.arguments,
                                risk: event.risk,
                                preview: event.preview ?? null,
                            },
                        ],
                    }));
                    break;

                case 'redaction':
                    set(state => ({ redactions: { ...state.redactions, ...event.values } }));
                    break;

                case 'assist':
                    set({
                        assist: {
                            serverUuid: event.server_uuid,
                            serverName: event.server_name,
                            writable: event.writable,
                            reason: event.reason,
                        },
                    });
                    break;

                case 'question_required':
                    sealAssistant();
                    set(state => ({
                        loading: false,
                        step: null,
                        activity: null,
                        entries: [
                            ...state.entries,
                            {
                                kind: 'question',
                                key: nextKey(),
                                turnId: event.turn_id,
                                question: event.question,
                                options: event.options,
                                allowOther: event.allow_other,
                            },
                        ],
                    }));
                    break;

                case 'error':
                    fail(event.error);
                    break;

                case 'done': {
                    // 'complete' is the ordinary ending and speaks for itself —
                    // the answer is right there. The two ceilings do not: the
                    // stream simply closes, and nothing on screen distinguishes
                    // "finished" from "stopped".
                    const ended =
                        event.reason === 'step_limit'
                            ? m['server.ai.endedStepLimit']()
                            : event.reason === 'time_limit'
                              ? m['server.ai.endedTimeLimit']()
                              : null;

                    if (ended !== null) {
                        sealAssistant();
                        set(state => ({
                            entries: [...state.entries, { kind: 'notice', key: nextKey(), content: ended }],
                        }));
                    }
                    break;
                }

                case 'operation':
                    break;
            }
        };

        /**
         * Restart the stall clock. Called on every byte the stream produces, so
         * the countdown only ever runs against genuine silence.
         */
        const armStall = () => {
            clearStallTimer();
            stallTimer = setTimeout(() => {
                stallTimer = null;
                controller?.abort();
                fail(m['server.ai.stalled']());
            }, STALL_MS);
        };

        /** Shared teardown for both the start and resume streams. */
        const streamCallbacks = (): AgentStreamCallbacks => ({
            onEvent: handleEvent,
            onActivity: armStall,
            onComplete: () => {
                // A suspension closes the stream deliberately; settling then
                // would wipe the card the user still has to act on.
                const last = get().entries.at(-1)?.kind;
                if (last === 'approval' || last === 'question') {
                    suspend();
                    return;
                }
                settle();
            },
            onError: (error: Error) => fail(error.message),
        });

        const beginTurn = () => {
            controller?.abort();
            controller = new AbortController();

            clearSlowTimer();
            slowTimer = setTimeout(() => set({ slowHint: true }), SLOW_HINT_MS);
            armStall();

            set({
                loading: true,
                slowHint: false,
                queue: null,
                step: null,
                activity: { phase: 'waiting', startedAt: Date.now() },
            });

            return controller.signal;
        };

        const resume = (turnId: string, body: Omit<AgentDecisionBody, 'turnId'>) => {
            const { target, loading } = get();
            if (!target || loading) return;

            adapter.decide(target, { turnId, ...body }, streamCallbacks(), beginTurn());
        };

        return {
            target: initialTarget,
            conversationId: null,
            entries: [],
            loading: false,
            queue: null,
            step: null,
            activity: null,
            slowHint: false,
            drawerOpen: false,
            redactions: {},
            assist: null,

            bind: target => {
                if (get().target === target) return;

                // Switching servers must not carry a conversation across — the
                // agent is bound to one server for the life of a turn.
                controller?.abort();
                controller = null;
                clearSlowTimer();
                clearStallTimer();

                set({
                    target,
                    conversationId: null,
                    entries: [],
                    loading: false,
                    queue: null,
                    step: null,
                    activity: null,
                    slowHint: false,
                    drawerOpen: false,
                    redactions: {},
                    assist: null,
                });
            },

            setDrawer: open => set({ drawerOpen: open }),
            toggleDrawer: () => set(state => ({ drawerOpen: !state.drawerOpen })),

            newChat: () => {
                if (get().loading) return;
                // A new conversation is a new session: whatever server the last
                // one was inside, this one starts outside it again.
                set({
                    conversationId: null,
                    entries: [],
                    queue: null,
                    step: null,
                    activity: null,
                    redactions: {},
                    assist: null,
                });
            },

            loadTranscript: (conversationId, messages, redactions) => {
                set({
                    conversationId,
                    entries: fromStored(messages),
                    queue: null,
                    step: null,
                    activity: null,
                    // Replaced rather than merged: these are the tokens *this*
                    // transcript was written against, and carrying the last
                    // conversation's map across would resolve a token to
                    // somebody else.
                    redactions: redactions ?? {},
                    assist: null,
                });
            },

            setAssist: session => set({ assist: session }),

            loadFailed: () => {
                set(state => ({
                    entries: [
                        ...state.entries,
                        { kind: 'assistant', key: nextKey(), content: m['server.ai.loadFailed'](), error: true },
                    ],
                }));
            },

            send: (query, consoleBuffer) => {
                const { target, loading, conversationId } = get();
                const trimmed = query.trim();
                if (!trimmed || loading || !target) return;

                set(state => ({ entries: [...state.entries, { kind: 'user', key: nextKey(), content: trimmed }] }));

                adapter.startTurn(
                    target,
                    { query: trimmed, conversationId, console: consoleBuffer },
                    streamCallbacks(),
                    beginTurn(),
                );
            },

            decide: (turnId, decision, confirmation) => {
                // Declining resolves the call that suspended the turn, and the
                // backend answers it into the transcript rather than over the
                // stream — so its row would otherwise keep spinning behind a
                // card the user has already dismissed.
                if (decision === 'reject') sealTools(m['server.ai.tool.declined']());

                set(state => ({
                    entries: state.entries.map(entry =>
                        entry.kind === 'approval' && entry.turnId === turnId
                            ? { ...entry, decision: decision === 'approve' ? 'approved' : 'rejected' }
                            : entry.kind === 'question' && entry.turnId === turnId && decision === 'reject'
                              ? { ...entry, dismissed: true }
                              : entry,
                    ),
                }));

                resume(turnId, { decision, confirmation });
            },

            answer: (turnId, value) => {
                const trimmed = value.trim();
                if (trimmed === '') return;

                set(state => ({
                    entries: state.entries.map(entry =>
                        entry.kind === 'question' && entry.turnId === turnId
                            ? { ...entry, answer: trimmed }
                            : entry,
                    ),
                }));

                resume(turnId, { decision: 'answer', answer: trimmed });
            },

            cancel: () => {
                controller?.abort();
                controller = null;
                clearSlowTimer();
                clearStallTimer();
                sealAssistant();
                sealTools(m['server.ai.tool.cancelled']());
                patchLast(
                    entry => entry.kind === 'assistant',
                    entry =>
                        entry.kind === 'assistant'
                            ? { ...entry, content: `${entry.content}\n\n*${m['server.ai.cancelled']()}*` }
                            : entry,
                );
                set({ loading: false, queue: null, step: null, activity: null, slowHint: false });
            },
        };
    });
}

/**
 * Put the real values back into something the model wrote.
 *
 * Applied at render time rather than to the stored entry, for two reasons. A
 * token can arrive after the prose that mentions it — the redaction event and
 * the text deltas are independent — so rewriting on arrival would miss it. And
 * keeping the entries as the model saw them means the transcript we hold and the
 * transcript the model read are the same thing, which is what makes the tool
 * payload panel worth opening.
 *
 * Cheap enough to do per render: the map is bounded at 250 entries and only
 * non-empty when redaction actually fired.
 */
export function restoreRedactions(text: string, map: Record<string, string>): string {
    if (text === '' || Object.keys(map).length === 0) return text;

    // Tokens are `[kind_hex]` — the hex being a slice of an HMAC of the value,
    // so that two maps for the same person agree and two maps for different
    // people cannot collide. A single pass over the pattern is enough, and it
    // cannot re-enter a value that happens to contain one.
    return text.replace(/\[[a-z]+_[0-9a-f]+]/g, token => map[token] ?? token);
}

/**
 * The same, over a decoded JSON payload.
 */
export function restoreRedactionsDeep(value: unknown, map: Record<string, string>): unknown {
    if (Object.keys(map).length === 0) return value;

    if (typeof value === 'string') return restoreRedactions(value, map);
    if (Array.isArray(value)) return value.map(item => restoreRedactionsDeep(item, map));

    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) out[key] = restoreRedactionsDeep(item, map);
        return out;
    }

    return value;
}

/**
 * Rebuild a transcript from stored messages.
 *
 * Tool rows carry their arguments on the assistant message that requested them
 * and their outcome on the tool message that answered, so the two are stitched
 * back together by call id.
 */
function fromStored(messages: StoredMessage[]): ChatEntry[] {
    const pendingArgs = new Map<string, { tool: string; args: Record<string, unknown> }>();
    const entries: ChatEntry[] = [];

    for (const message of messages) {
        if (message.role === 'user') {
            entries.push({ kind: 'user', key: nextKey(), content: message.content ?? '' });
            continue;
        }

        if (message.role === 'assistant') {
            for (const call of message.tool_calls ?? []) {
                pendingArgs.set(call.id, { tool: call.name, args: call.arguments ?? {} });
            }

            if ((message.content ?? '').trim() !== '') {
                entries.push({ kind: 'assistant', key: nextKey(), content: message.content ?? '' });
            }
            continue;
        }

        // A tool row. Its stored content is the compact {ok, summary} the card
        // renders — the model's full result is never kept.
        const requested = message.tool_call_id ? pendingArgs.get(message.tool_call_id) : undefined;
        let ok = true;
        let summary: string | undefined;

        try {
            const parsed = JSON.parse(message.content ?? '{}');
            ok = parsed.ok !== false;
            summary = typeof parsed.summary === 'string' ? parsed.summary : undefined;
        } catch {
            /* fall back to a bare successful row */
        }

        entries.push({
            kind: 'tool',
            key: nextKey(),
            callId: message.tool_call_id ?? nextKey(),
            tool: message.tool_name ?? requested?.tool ?? 'unknown',
            args: requested?.args ?? {},
            // Replayed rows have no live tier; the card falls back to a neutral
            // presentation rather than implying a risk that was not recorded.
            risk: 'safe',
            status: ok ? 'ok' : 'error',
            summary,
        });
    }

    return entries;
}

/**
 * The server assistant: bound to one server.
 *
 * It used to carry a plain advisory chat mode alongside the agent, chosen from a
 * toggle above the composer. That mode is gone. The argument that retired the
 * admin Playground applies here unchanged — a chat that cannot look anything up
 * is a worse version of an agent that can, and it is worse in the way that costs
 * most, by answering confidently about a server it never read. Keeping it also
 * meant a second persistence path, a second history reconstruction assembled
 * from what happened to be on screen, and a branch through every turn.
 */
export const useAgentChat = createAgentChatStore({
    startTurn: (uuid, body, callbacks, signal) => streamAgentTurn(uuid, body, callbacks, signal),
    decide: (uuid, body, callbacks, signal) => streamAgentDecision(uuid, body, callbacks, signal),
});

/**
 * The admin assistant. Agent-only: the Playground it replaces already proved
 * that a tool-less admin chat has nothing to offer that the server assistant
 * does not, and a plain chat about panel records cannot look anything up.
 *
 * The target is a constant rather than an identifier because this surface is
 * bound to the panel itself, not to a resource.
 */
export const ADMIN_AGENT_TARGET = 'admin';

export const useAdminAgentChat = createAgentChatStore(
    {
        startTurn: (_target, body, callbacks, signal) => streamAdminAgentTurn(body, callbacks, signal),
        decide: (_target, body, callbacks, signal) => streamAdminAgentDecision(body, callbacks, signal),
    },
    ADMIN_AGENT_TARGET,
);
