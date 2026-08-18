import http from '@/lib/http';
import { streamAgentRequest, type AgentStreamCallbacks, type AiApprovalPreview, type AiRisk } from '@/lib/aiStream';

// Client-side AI surface for a server: POST /ai/agent for the tool-calling
// agent, which can suspend mid-turn and be resumed by /ai/agent/decide, plus the
// conversation store behind the history rail.
//
// Two endpoints have no client any more. `POST /ai` — advisory chat — lost its
// caller when chat mode was cut, and its other query type, `log_analysis`, never
// had a V2 caller despite the crash-analysis toggle on /admin/ai/limits still
// being wired to the setting. `GET /ai/agent/pending` lost its caller with the
// banner that polled it; a suspended turn now either has its card on screen or
// expires on its own. Both are left in place — retiring them is a decision about
// those features, not about this module.

export type ChatRole = 'user' | 'assistant' | 'tool';

/** A stored message, including the tool steps an agent turn produced. */
export interface StoredMessage {
    role: ChatRole;
    content: string | null;
    tool_calls:
        | {
              id: string;
              name: string;
              arguments: Record<string, unknown>;
              batch_parent_id?: string | null;
              batch_index?: number | null;
          }[]
        | null;
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

export interface AgentTurnStatus {
    turn_id: string;
    status: 'running' | 'success' | 'error' | 'suspended' | 'cancelled';
    terminal: boolean;
    error?: string;
    conversation_id?: number;
    redactions?: Record<string, string>;
    messages?: StoredMessage[];
    pending?:
        | {
              kind: 'approval';
              turn_id: string;
              tool: string;
              arguments: Record<string, unknown>;
              risk: AiRisk;
              preview?: AiApprovalPreview;
          }
        | {
              kind: 'question';
              turn_id: string;
              tool: string;
              question: string;
              options: { label: string; description?: string }[];
              allow_other: boolean;
          };
}

export async function getAgentTurnStatus(uuid: string, turnId: string): Promise<AgentTurnStatus> {
    const { data } = await http.get(`/api/client/servers/${uuid}/ai/agent/turns/${turnId}`);
    return data.data as AgentTurnStatus;
}

/**
 * Start an agent turn.
 *
 * No history is sent: the backend replays what it stored. A turn also opens its
 * own conversation when none is named, and reports the id back on the stream.
 */
export function streamAgentTurn(
    uuid: string,
    opts: { query: string; conversationId?: number | null; console?: string | null; ticket?: string },
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAgentRequest(
        `/api/client/servers/${uuid}/ai/agent`,
        {
            query: opts.query,
            conversation_id: opts.conversationId ?? undefined,
            console: opts.console ?? undefined,
            // The queue place this attempt already holds, if the last one was
            // turned away. Without it the turn rejoins at the back.
            ticket: opts.ticket ?? undefined,
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
    opts: {
        turnId: string;
        decision: 'approve' | 'reject' | 'answer';
        confirmation?: string;
        answer?: string;
        ticket?: string;
    },
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
            ticket: opts.ticket ?? undefined,
        },
        callbacks,
        signal,
    );
}

/**
 * Ask a running turn to stop.
 *
 * Aborting the stream only stops the browser reading; the turn carries on
 * spending budget and running tools. This is the half that reaches the server.
 * It reports that the request was recorded, not that the turn has ended — a
 * tool already in flight always finishes — so the caller reconciles afterwards
 * for the terminal state.
 */
export async function cancelAgentTurn(uuid: string, turnId: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/ai/agent/turns/${turnId}/cancel`);
}

/** Give up a queue place, rather than letting it lapse on its own. */
export async function releaseAgentQueue(uuid: string, ticket: string): Promise<void> {
    await http.delete(`/api/client/servers/${uuid}/ai/agent/queue/${encodeURIComponent(ticket)}`);
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
