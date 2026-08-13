import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { m } from '@/i18n';
import type { AgentEvent, AgentStreamCallbacks, AiDiffPreview, AiRisk } from '@/lib/aiStream';
import {
    appendMessages,
    createConversation,
    streamAgentDecision,
    streamAgentTurn,
    streamServerAiQuery,
    type StoredMessage,
} from '@/api/ai';
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

export type ChatMode = 'chat' | 'agent';

export interface QuestionOption {
    label: string;
    description?: string;
}

export type ChatEntry =
    | { kind: 'user'; key: string; content: string }
    | { kind: 'assistant'; key: string; content: string; streaming?: boolean; error?: boolean }
    | {
          kind: 'tool';
          key: string;
          callId: string;
          tool: string;
          args: Record<string, unknown>;
          risk: AiRisk;
          status: 'running' | 'ok' | 'error';
          summary?: string;
      }
    | {
          kind: 'approval';
          key: string;
          turnId: string;
          tool: string;
          args: Record<string, unknown>;
          risk: AiRisk;
          preview: AiDiffPreview | null;
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
    /** Plain advisory chat. Absent on surfaces that only offer the agent. */
    chat?: (
        target: string,
        body: { query: string; conversationId: number | null; history: StoredChatTurn[] },
        callbacks: { onChunk: (chunk: string) => void; onComplete: () => void; onError: (error: Error) => void },
        signal: AbortSignal,
    ) => void;
    /** Persist an advisory exchange, for surfaces whose chat has no server-side store. */
    persistChat?: (target: string, conversationId: number, question: string, answer: string) => Promise<void>;
    /** Open a conversation for advisory chat, returning its id. */
    openConversation?: (target: string, title: string) => Promise<number>;
}

export interface StoredChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface AgentChatState {
    target: string | null;
    mode: ChatMode;
    conversationId: number | null;
    entries: ChatEntry[];
    loading: boolean;
    queue: QueuePosition | null;
    step: { step: number; maxSteps: number } | null;
    slowHint: boolean;
    drawerOpen: boolean;
    /** Whether this surface offers a plain-chat mode alongside the agent. */
    readonly supportsChat: boolean;

    bind: (target: string) => void;
    setMode: (mode: ChatMode) => void;
    setDrawer: (open: boolean) => void;
    toggleDrawer: () => void;

    newChat: () => void;
    loadTranscript: (conversationId: number, messages: StoredMessage[]) => void;
    loadFailed: () => void;

    send: (query: string, consoleBuffer?: string | null) => void;
    decide: (turnId: string, decision: 'approve' | 'reject', confirmation?: string) => void;
    answer: (turnId: string, value: string) => void;
    cancel: () => void;
    /** Re-open an approval the user left unanswered on a previous visit. */
    restorePending: (entry: Omit<Extract<ChatEntry, { kind: 'approval' }>, 'key' | 'kind'>) => void;
}

// No token arriving within this window means a cold model load, not a hang.
const SLOW_HINT_MS = 5000;

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

    const clearSlowTimer = () => {
        if (slowTimer) clearTimeout(slowTimer);
        slowTimer = null;
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

        const appendText = (delta: string) => {
            clearSlowTimer();
            set(state => {
                const entries = [...state.entries];
                const last = entries[entries.length - 1];

                if (last?.kind === 'assistant' && last.streaming) {
                    entries[entries.length - 1] = { ...last, content: last.content + delta };
                } else {
                    entries.push({ kind: 'assistant', key: nextKey(), content: delta, streaming: true });
                }

                return { entries, slowHint: false };
            });
        };

        /** Close any open assistant bubble, dropping it if nothing was written. */
        const sealAssistant = () => {
            set(state => {
                const index = state.entries.length - 1;
                const last = state.entries[index];
                if (last?.kind !== 'assistant' || !last.streaming) return state;

                const entries = [...state.entries];
                if (last.content.trim() === '') entries.pop();
                else entries[index] = { ...last, streaming: false };

                return { entries };
            });
        };

        const settle = () => {
            clearSlowTimer();
            controller = null;
            sealAssistant();
            set({ loading: false, queue: null, step: null, slowHint: false });
        };

        const fail = (message: string) => {
            clearSlowTimer();
            controller = null;
            sealAssistant();
            set(state => ({
                loading: false,
                queue: null,
                step: null,
                slowHint: false,
                entries: [...state.entries, { kind: 'assistant', key: nextKey(), content: message, error: true }],
            }));
        };

        /** A suspension leaves the composer free but the turn alive. */
        const suspend = () => {
            clearSlowTimer();
            controller = null;
            set({ loading: false, queue: null, step: null, slowHint: false });
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
                    set({ queue: null, step: { step: event.step, maxSteps: event.max_steps } });
                    break;

                case 'text':
                    appendText(event.content);
                    break;

                case 'tool_call':
                    clearSlowTimer();
                    sealAssistant();
                    set(state => ({
                        slowHint: false,
                        entries: [
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
                    }));
                    break;

                case 'tool_result':
                    set(state => ({
                        entries: state.entries.map(entry =>
                            entry.kind === 'tool' && entry.callId === event.id && entry.status === 'running'
                                ? { ...entry, status: event.ok ? 'ok' : 'error', summary: event.summary }
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

                case 'question_required':
                    sealAssistant();
                    set(state => ({
                        loading: false,
                        step: null,
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

                case 'done':
                case 'operation':
                    break;
            }
        };

        /** Shared teardown for both the start and resume streams. */
        const streamCallbacks = (): AgentStreamCallbacks => ({
            onEvent: handleEvent,
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

            set({ loading: true, slowHint: false, queue: null, step: null });

            return controller.signal;
        };

        const resume = (turnId: string, body: Omit<AgentDecisionBody, 'turnId'>) => {
            const { target, loading } = get();
            if (!target || loading) return;

            adapter.decide(target, { turnId, ...body }, streamCallbacks(), beginTurn());
        };

        return {
            target: initialTarget,
            mode: 'agent',
            conversationId: null,
            entries: [],
            loading: false,
            queue: null,
            step: null,
            slowHint: false,
            drawerOpen: false,
            supportsChat: typeof adapter.chat === 'function',

            bind: target => {
                if (get().target === target) return;

                // Switching servers must not carry a conversation across — the
                // agent is bound to one server for the life of a turn.
                controller?.abort();
                controller = null;
                clearSlowTimer();

                set({
                    target,
                    conversationId: null,
                    entries: [],
                    loading: false,
                    queue: null,
                    step: null,
                    slowHint: false,
                    drawerOpen: false,
                });
            },

            setMode: mode => set({ mode }),
            setDrawer: open => set({ drawerOpen: open }),
            toggleDrawer: () => set(state => ({ drawerOpen: !state.drawerOpen })),

            newChat: () => {
                if (get().loading) return;
                set({ conversationId: null, entries: [], queue: null, step: null });
            },

            loadTranscript: (conversationId, messages) => {
                set({ conversationId, entries: fromStored(messages), queue: null, step: null });
            },

            loadFailed: () => {
                set(state => ({
                    entries: [
                        ...state.entries,
                        { kind: 'assistant', key: nextKey(), content: m['server.ai.loadFailed'](), error: true },
                    ],
                }));
            },

            send: (query, consoleBuffer) => {
                const { target, mode, loading, conversationId } = get();
                const trimmed = query.trim();
                if (!trimmed || loading || !target) return;

                set(state => ({ entries: [...state.entries, { kind: 'user', key: nextKey(), content: trimmed }] }));

                const signal = beginTurn();

                if (mode === 'agent' || !adapter.chat) {
                    adapter.startTurn(
                        target,
                        { query: trimmed, conversationId, console: consoleBuffer },
                        streamCallbacks(),
                        signal,
                    );
                    return;
                }

                // Advisory chat has no server-side persistence of its own, so the
                // exchange is stored from here once it completes, and prior turns
                // are replayed from what is on screen.
                let answer = '';
                const history: StoredChatTurn[] = [];

                for (const entry of get().entries) {
                    if (entry.kind === 'user') history.push({ role: 'user', content: entry.content });
                    else if (entry.kind === 'assistant' && !entry.error) {
                        history.push({ role: 'assistant', content: entry.content });
                    }
                }

                adapter.chat(
                    target,
                    {
                        query: trimmed,
                        conversationId,
                        // The message just pushed is the query itself; sending it
                        // twice would have the model answer it as context.
                        history: history.slice(-11, -1),
                    },
                    {
                        onChunk: chunk => {
                            answer += chunk;
                            appendText(chunk);
                        },
                        onComplete: () => {
                            settle();
                            if (answer.trim() !== '') void persistChat(adapter, target, get, set, trimmed, answer);
                        },
                        onError: error => fail(error.message),
                    },
                    signal,
                );
            },

            decide: (turnId, decision, confirmation) => {
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
                sealAssistant();
                patchLast(
                    entry => entry.kind === 'assistant',
                    entry =>
                        entry.kind === 'assistant'
                            ? { ...entry, content: `${entry.content}\n\n*${m['server.ai.cancelled']()}*` }
                            : entry,
                );
                set({ loading: false, queue: null, step: null, slowHint: false });
            },

            restorePending: pending => {
                const { entries } = get();
                if (entries.some(entry => entry.kind === 'approval' && entry.turnId === pending.turnId)) return;

                set({ entries: [...entries, { kind: 'approval', key: nextKey(), ...pending }] });
            },
        };
    });
}

/**
 * Store an advisory-chat exchange, opening a conversation if this was the first
 * message. Agent turns do not come through here — the backend records those.
 */
async function persistChat(
    adapter: AgentChatAdapter,
    target: string,
    get: () => AgentChatState,
    set: (partial: Partial<AgentChatState>) => void,
    question: string,
    answer: string,
): Promise<void> {
    if (!adapter.persistChat || !adapter.openConversation) return;

    try {
        let id = get().conversationId;

        if (id === null) {
            id = await adapter.openConversation(target, question.slice(0, 80));
            set({ conversationId: id });
        }

        await adapter.persistChat(target, id, question, answer);
    } catch {
        /* a lost transcript is not worth surfacing over the answer itself */
    }
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
 * The server assistant: bound to one server, and the only surface with a plain
 * advisory chat mode alongside the agent.
 */
export const useAgentChat = createAgentChatStore({
    startTurn: (uuid, body, callbacks, signal) =>
        streamAgentTurn(uuid, body, callbacks, signal),
    decide: (uuid, body, callbacks, signal) => streamAgentDecision(uuid, body, callbacks, signal),
    chat: (uuid, body, callbacks, signal) =>
        streamServerAiQuery(uuid, { ...body, queryType: 'freeform' }, callbacks, signal),
    openConversation: async (uuid, title) => (await createConversation(uuid, title)).id,
    persistChat: async (uuid, conversationId, question, answer) => {
        await appendMessages(uuid, conversationId, [
            { role: 'user', content: question },
            { role: 'assistant', content: answer },
        ]);
    },
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
