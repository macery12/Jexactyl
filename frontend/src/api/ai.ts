import http from '@/lib/http';
import {
    streamAgentRequest,
    streamAiRequest,
    type AgentStreamCallbacks,
    type AiDiffPreview,
    type AiRisk,
    type AiStreamCallbacks,
} from '@/lib/aiStream';

// Client-side AI surface for a server. Two endpoints sit behind this:
// POST /ai for advisory chat, and POST /ai/agent for the tool-calling agent,
// which can suspend mid-turn and be resumed by /ai/agent/decide.

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatHistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

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

export type AiQueryType = 'freeform' | 'log_analysis';

export function streamServerAiQuery(
    uuid: string,
    opts: {
        query: string;
        queryType: AiQueryType;
        conversationId?: number | null;
        history?: ChatHistoryMessage[];
    },
    callbacks: AiStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAiRequest(
        `/api/client/servers/${uuid}/ai`,
        {
            query: opts.query,
            query_type: opts.queryType,
            conversation_id: opts.conversationId ?? undefined,
            messages: opts.history ?? [],
        },
        callbacks,
        signal,
    );
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
 * Resolve an action the turn suspended on, and resume it.
 *
 * `confirmation` carries the typed server name a destructive action requires.
 */
export function streamAgentDecision(
    uuid: string,
    opts: { turnId: string; decision: 'approve' | 'reject'; confirmation?: string },
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAgentRequest(
        `/api/client/servers/${uuid}/ai/agent/decide`,
        {
            turn_id: opts.turnId,
            decision: opts.decision,
            confirmation: opts.confirmation ?? undefined,
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

export async function createConversation(uuid: string, title?: string): Promise<AiConversation> {
    const { data } = await http.post(`/api/client/servers/${uuid}/ai/conversations`, { title });
    return data.data as AiConversation;
}

export async function loadConversation(
    uuid: string,
    id: number,
): Promise<{ conversation: AiConversation; messages: StoredMessage[] }> {
    const { data } = await http.get(`/api/client/servers/${uuid}/ai/conversations/${id}`);
    return {
        conversation: data.data.conversation as AiConversation,
        messages: data.data.messages as StoredMessage[],
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

export async function appendMessages(uuid: string, id: number, messages: ChatHistoryMessage[]): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/ai/conversations/${id}/messages`, { messages });
}
