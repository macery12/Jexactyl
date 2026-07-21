import http from '@/lib/http';
import { streamAiRequest, type AiStreamCallbacks } from '@/lib/aiStream';

// Client-side AI surface for the server assistant. Mirrors V1's
// `api/routes/server/{ai,aiConversations}.ts` against the existing endpoints:
// POST /api/client/servers/{uuid}/ai (SSE stream) and the
// /ai/conversations CRUD. No backend shape changes.

export type ChatRole = 'user' | 'assistant';

export interface ChatHistoryMessage {
    role: ChatRole;
    content: string;
}

export interface AiConversation {
    id: number;
    title: string;
    is_saved: boolean;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
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
): Promise<{ conversation: AiConversation; messages: ChatHistoryMessage[] }> {
    const { data } = await http.get(`/api/client/servers/${uuid}/ai/conversations/${id}`);
    return {
        conversation: data.data.conversation as AiConversation,
        messages: (data.data.messages as { role: ChatRole; content: string }[]).map(({ role, content }) => ({
            role,
            content,
        })),
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
