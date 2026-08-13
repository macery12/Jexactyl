import { readCsrfToken } from '@/lib/globals';

// SSE client for the panel's AI endpoints.
//
// Two shapes travel over the same transport. The advisory chat emits
// `data: {"content": "..."}` and the agent emits a tagged union — but the agent
// deliberately keeps `content` on its text event, so a reader that only
// understands the old shape still renders a readable answer. That overlap is
// what lets one parser serve both.
//
// axios cannot consume incremental bodies, so this uses fetch + a reader.

export type AiRisk = 'safe' | 'write' | 'destructive';

export interface AiDiffPreview {
    kind: 'diff';
    file: string | null;
    original: string;
    updated: string;
}

export type AgentEvent =
    | { type: 'conversation'; id: number; title: string }
    | { type: 'queued'; position: number; ahead: number; eta_seconds: number }
    | { type: 'text'; content: string }
    | { type: 'tool_call'; id: string; tool: string; arguments: Record<string, unknown>; risk: AiRisk }
    | { type: 'tool_result'; id: string; tool: string; ok: boolean; summary: string }
    | {
          type: 'approval_required';
          turn_id: string;
          tool: string;
          arguments: Record<string, unknown>;
          risk: AiRisk;
          preview?: AiDiffPreview;
      }
    | { type: 'operation'; uuid: string; kind: string; status: string }
    | { type: 'step'; step: number; max_steps: number }
    | { type: 'done'; reason: string }
    | { type: 'error'; error: string; retryable?: boolean };

export interface AiStreamCallbacks {
    onChunk: (chunk: string) => void;
    onComplete: () => void;
    onError: (error: Error) => void;
}

export interface AgentStreamCallbacks {
    onEvent: (event: AgentEvent) => void;
    onComplete: () => void;
    onError: (error: Error) => void;
}

/**
 * Read an SSE body, handing each decoded `data:` payload to `onFrame`.
 *
 * Returns once the stream ends or `onFrame` reports the terminal sentinel.
 */
async function readEventStream(
    url: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onFrame: (payload: string) => boolean,
): Promise<void> {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': readCsrfToken(),
        },
        body: JSON.stringify({ ...body, stream: true }),
        credentials: 'same-origin',
        signal,
    });

    if (!response.ok) {
        // Failures before the stream opens (rate limits, gating, a model that
        // cannot call tools) are plain JSON, not SSE.
        let message = `Request failed (${response.status})`;
        try {
            const data = await response.json();
            if (typeof data?.error === 'string') message = data.error;
            else if (typeof data?.message === 'string') message = data.message;
        } catch {
            /* keep the status message */
        }
        throw new Error(message);
    }

    if (!response.body) throw new Error('Streaming is not supported by this browser.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });

        let newlineAt = buffer.indexOf('\n');
        while (newlineAt !== -1) {
            const line = buffer.slice(0, newlineAt).trim();
            buffer = buffer.slice(newlineAt + 1);
            newlineAt = buffer.indexOf('\n');

            // `:` lines are keep-alive comments the backend sends so proxies
            // don't time out while the model is still thinking.
            if (!line.startsWith('data: ')) continue;
            if (onFrame(line.slice(6))) return;
        }
    }
}

/**
 * Plain advisory chat: text deltas only.
 */
export function streamAiRequest(
    url: string,
    body: Record<string, unknown>,
    { onChunk, onComplete, onError }: AiStreamCallbacks,
    signal?: AbortSignal,
): void {
    let finished = false;

    readEventStream(url, body, signal, payload => {
        if (payload === '[DONE]') {
            finished = true;
            onComplete();
            return true;
        }

        try {
            const data = JSON.parse(payload);
            if (typeof data.error === 'string') {
                finished = true;
                onError(new Error(data.error));
                return true;
            }
            if (typeof data.content === 'string') onChunk(data.content);
        } catch {
            /* ignore malformed frames */
        }

        return false;
    })
        .then(() => {
            if (!finished) onComplete();
        })
        .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            onError(err instanceof Error ? err : new Error(String(err)));
        });
}

/**
 * The agent: a tagged event stream.
 *
 * Unknown event types are dropped rather than treated as errors, so a panel
 * running slightly behind its backend degrades instead of breaking.
 */
export function streamAgentRequest(
    url: string,
    body: Record<string, unknown>,
    { onEvent, onComplete, onError }: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    let finished = false;

    readEventStream(url, body, signal, payload => {
        if (payload === '[DONE]') {
            finished = true;
            onComplete();
            return true;
        }

        try {
            const data = JSON.parse(payload);
            if (typeof data?.type === 'string') {
                onEvent(data as AgentEvent);
            } else if (typeof data?.error === 'string') {
                // A pre-agent error frame, or an error raised before the turn
                // had a type to report under.
                onEvent({ type: 'error', error: data.error });
            }
        } catch {
            /* ignore malformed frames */
        }

        return false;
    })
        .then(() => {
            if (!finished) onComplete();
        })
        .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            onError(err instanceof Error ? err : new Error(String(err)));
        });
}
