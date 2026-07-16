import http from '@/api/http';

export interface Conversation {
    id: number;
    title: string;
    is_saved: boolean;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}

export const listConversations = (serverUuid: string): Promise<Conversation[]> =>
    http.get(`/api/client/servers/${serverUuid}/ai/conversations`).then(r => r.data.data);

export const createConversation = (serverUuid: string, title?: string): Promise<Conversation> =>
    http.post(`/api/client/servers/${serverUuid}/ai/conversations`, { title }).then(r => r.data.data);

export const loadConversation = (
    serverUuid: string,
    conversationId: number,
): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> =>
    http.get(`/api/client/servers/${serverUuid}/ai/conversations/${conversationId}`).then(r => r.data.data);

export const deleteConversation = (serverUuid: string, conversationId: number): Promise<void> =>
    http.delete(`/api/client/servers/${serverUuid}/ai/conversations/${conversationId}`).then(() => undefined);

export const toggleSaveConversation = (
    serverUuid: string,
    conversationId: number,
): Promise<{ id: number; is_saved: boolean; expires_at: string | null }> =>
    http.patch(`/api/client/servers/${serverUuid}/ai/conversations/${conversationId}/save`).then(r => r.data.data);

export const appendMessages = (
    serverUuid: string,
    conversationId: number,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> =>
    http
        .post(`/api/client/servers/${serverUuid}/ai/conversations/${conversationId}/messages`, { messages })
        .then(() => undefined);
