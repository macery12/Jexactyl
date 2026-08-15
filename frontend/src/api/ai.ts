import http from '@/lib/http';
import {
    streamAgentRequest,
    type AgentStreamCallbacks,
    type AiDiffPreview,
    type AiRisk,
} from '@/lib/aiStream';

// Client-side AI surface for a server: POST /ai/agent for the tool-calling
// agent, which can suspend mid-turn and be resumed by /ai/agent/decide, plus the
// conversation store behind the history rail.
//
// `POST /ai` — the advisory-chat endpoint — no longer has a client. Chat mode
// was cut from the assistant, and its other query type, `log_analysis`, has
// never had a V2 caller despite the crash-analysis toggle on /admin/ai/limits
// still being wired to the setting. The endpoint is left in place; retiring it
// is a decision about the crash-analysis feature, not about this module.

export type ChatRole = 'user' | 'assistant' | 'tool';

/** A stored message, including the tool steps an agent turn produced. */
export interface StoredMessage {
    role: ChatRole;
    content: string | null;
    tool_calls: { id: string; name: string; arguments: Record<string, unknown> }[] | null;
    tool_call_id: string | null;
    tool_name: string | null;
    step: number | null;
}

export interface AiConversation {
    id: number;
    title: string;
    is_saved: boolean;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface PendingAction {
    turn_id: string;
    conversation_id: number | null;
    tool: string;
    arguments: Record<string, unknown>;
    risk: AiRisk;
    preview: AiDiffPreview | null;
    created_at: string | null;
    expires_at: string | null;
}

/**
 * Start an agent turn.
 *
 * No history is sent: the backend replays what it stored. A turn also opens its
 * own conversation when none is named, and reports the id back on the stream.
 */
export function streamAgentTurn(
    uuid: string,
    opts: { query: string; conversationId?: number | null; console?: string | null },
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAgentRequest(
        `/api/client/servers/${uuid}/ai/agent`,
        {
            query: opts.query,
            conversation_id: opts.conversationId ?? undefined,
            console: opts.console ?? undefined,
        },
        callbacks,
        signal,
    );
}

/**
 * Resolve whatever the turn suspended on, and resume it.
 *
 * `confirmation` carries the typed server name a destructive action requires;
 * `answer` carries the user's reply when the model asked a question.
 */
export function streamAgentDecision(
    uuid: string,
    opts: { turnId: string; decision: 'approve' | 'reject' | 'answer'; confirmation?: string; answer?: string },
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAgentRequest(
        `/api/client/servers/${uuid}/ai/agent/decide`,
        {
            turn_id: opts.turnId,
            decision: opts.decision,
            confirmation: opts.confirmation ?? undefined,
            answer: opts.answer ?? undefined,
        },
        callbacks,
        signal,
    );
}

export async function listPendingActions(uuid: string): Promise<PendingAction[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/ai/agent/pending`);
    return data.data as PendingAction[];
}

export async function listConversations(uuid: string): Promise<AiConversation[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/ai/conversations`);
    return data.data as AiConversation[];
}

export async function loadConversation(
    uuid: string,
    id: number,
): Promise<{
    conversation: AiConversation;
    messages: StoredMessage[];
    /** token => the value it stands for, for anything redacted on the way to the model. */
    redactions: Record<string, string>;
}> {
    const { data } = await http.get(`/api/client/servers/${uuid}/ai/conversations/${id}`);
    return {
        conversation: data.data.conversation as AiConversation,
        messages: data.data.messages as StoredMessage[],
        redactions: (data.data.redactions ?? {}) as Record<string, string>,
    };
}

export async function deleteConversation(uuid: string, id: number): Promise<void> {
    await http.delete(`/api/client/servers/${uuid}/ai/conversations/${id}`);
}

export async function toggleSaveConversation(
    uuid: string,
    id: number,
): Promise<Pick<AiConversation, 'id' | 'is_saved' | 'expires_at'>> {
    const { data } = await http.patch(`/api/client/servers/${uuid}/ai/conversations/${id}/save`);
    return data.data;
}
