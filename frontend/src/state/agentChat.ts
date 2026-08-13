import { create } from 'zustand';
import { m } from '@/i18n';
import type { AgentEvent, AiDiffPreview, AiRisk } from '@/lib/aiStream';
import {
    appendMessages,
    createConversation,
    streamAgentDecision,
    streamAgentTurn,
    streamServerAiQuery,
    type StoredMessage,
} from '@/api/ai';

// One conversation, shared by the AI page and the dock drawer.
//
// Chat state lives in a store rather than in a component because a turn can run
// for minutes and must survive the user navigating away — the whole point of
// the drawer is to ask a question while you work somewhere else. The abort
// controller and timers are module-scoped for the same reason: they belong to
// the turn, not to whichever component happens to be mounted.

export type ChatMode = 'chat' | 'agent';

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
      };

export interface QueuePosition {
    position: number;
    ahead: number;
    etaSeconds: number;
}

interface AgentChatState {
    serverUuid: string | null;
    mode: ChatMode;
    conversationId: number | null;
    entries: ChatEntry[];
    loading: boolean;
    queue: QueuePosition | null;
    step: { step: number; maxSteps: number } | null;
    slowHint: boolean;
    drawerOpen: boolean;

    bind: (serverUuid: string) => void;
    setMode: (mode: ChatMode) => void;
    setDrawer: (open: boolean) => void;
    toggleDrawer: () => void;

    newChat: () => void;
    loadTranscript: (conversationId: number, messages: StoredMessage[]) => void;
    loadFailed: () => void;

    send: (query: string, consoleBuffer?: string | null) => void;
    decide: (turnId: string, decision: 'approve' | 'reject', confirmation?: string) => void;
    cancel: () => void;
    /** Re-open an approval the user left unanswered on a previous visit. */
    restorePending: (entry: Omit<Extract<ChatEntry, { kind: 'approval' }>, 'key' | 'kind'>) => void;
}

// No token arriving within this window means a cold model load, not a hang.
const SLOW_HINT_MS = 5000;

let controller: AbortController | null = null;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;

const nextKey = () => `e${++sequence}`;

function clearSlowTimer() {
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = null;
}

export const useAgentChat = create<AgentChatState>((set, get) => {
    /** Replace the tail entry when it matches a predicate. */
    const patchLast = (
        match: (entry: ChatEntry) => boolean,
        patch: (entry: ChatEntry) => ChatEntry,
    ) => {
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

            case 'error':
                fail(event.error);
                break;

            case 'done':
            case 'operation':
                break;
        }
    };

    /** Shared teardown for both the start and resume streams. */
    const streamCallbacks = () => ({
        onEvent: handleEvent,
        onComplete: () => {
            // An approval closes the stream deliberately; settling then would
            // wipe the card the user still has to act on.
            if (get().entries.at(-1)?.kind === 'approval') {
                clearSlowTimer();
                controller = null;
                set({ loading: false, queue: null, step: null, slowHint: false });
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

    return {
        serverUuid: null,
        mode: 'agent',
        conversationId: null,
        entries: [],
        loading: false,
        queue: null,
        step: null,
        slowHint: false,
        drawerOpen: false,

        bind: serverUuid => {
            if (get().serverUuid === serverUuid) return;

            // Switching servers must not carry a conversation across — the
            // agent is bound to one server for the life of a turn.
            controller?.abort();
            controller = null;
            clearSlowTimer();

            set({
                serverUuid,
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
            const { serverUuid, mode, loading, conversationId } = get();
            const trimmed = query.trim();
            if (!trimmed || loading || !serverUuid) return;

            set(state => ({ entries: [...state.entries, { kind: 'user', key: nextKey(), content: trimmed }] }));

            const signal = beginTurn();

            if (mode === 'agent') {
                streamAgentTurn(
                    serverUuid,
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
            const history: { role: 'user' | 'assistant'; content: string }[] = [];

            for (const entry of get().entries) {
                if (entry.kind === 'user') history.push({ role: 'user', content: entry.content });
                else if (entry.kind === 'assistant' && !entry.error) {
                    history.push({ role: 'assistant', content: entry.content });
                }
            }

            streamServerAiQuery(
                serverUuid,
                {
                    query: trimmed,
                    queryType: 'freeform',
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
                        if (answer.trim() !== '') void persistChat(serverUuid, get, set, trimmed, answer);
                    },
                    onError: error => fail(error.message),
                },
                signal,
            );
        },

        decide: (turnId, decision, confirmation) => {
            const { serverUuid, loading } = get();
            if (!serverUuid || loading) return;

            set(state => ({
                entries: state.entries.map(entry =>
                    entry.kind === 'approval' && entry.turnId === turnId
                        ? { ...entry, decision: decision === 'approve' ? 'approved' : 'rejected' }
                        : entry,
                ),
            }));

            const signal = beginTurn();

            streamAgentDecision(serverUuid, { turnId, decision, confirmation }, streamCallbacks(), signal);
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

/**
 * Store an advisory-chat exchange, opening a conversation if this was the first
 * message. Agent turns do not come through here — the backend records those.
 */
async function persistChat(
    serverUuid: string,
    get: () => AgentChatState,
    set: (partial: Partial<AgentChatState>) => void,
    question: string,
    answer: string,
): Promise<void> {
    try {
        let id = get().conversationId;

        if (id === null) {
            const conversation = await createConversation(serverUuid, question.slice(0, 80));
            id = conversation.id;
            set({ conversationId: id });
        }

        await appendMessages(serverUuid, id, [
            { role: 'user', content: question },
            { role: 'assistant', content: answer },
        ]);
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
