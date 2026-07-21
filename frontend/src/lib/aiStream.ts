import { readCsrfToken } from '@/lib/globals';

// Minimal SSE client for the panel's AI streaming endpoints. The backend emits
// `data: {"content": "..."}` chunks, `data: {"error": "..."}` on failure and a
// final `data: [DONE]` sentinel (see AIController / IntelligenceController).
// axios can't consume incremental bodies, so this uses fetch + a reader — the
// same contract V1's handleQueryStream implemented.

export interface AiStreamCallbacks {
    onChunk: (chunk: string) => void;
    onComplete: () => void;
    onError: (error: Error) => void;
}

export function streamAiRequest(
    url: string,
    body: Record<string, unknown>,
    { onChunk, onComplete, onError }: AiStreamCallbacks,
    signal?: AbortSignal,
): void {
    fetch(url, {
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
    })
        .then(async response => {
            if (!response.ok) {
                // Error responses are plain JSON (rate limits, gating), not SSE.
                let message = `Request failed (${response.status})`;
                try {
                    const data = await response.json();
                    if (typeof data?.error === 'string') message = data.error;
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
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                let newlineAt = buffer.indexOf('\n');
                while (newlineAt !== -1) {
                    const line = buffer.slice(0, newlineAt).trim();
                    buffer = buffer.slice(newlineAt + 1);
                    newlineAt = buffer.indexOf('\n');

                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6);
                    if (payload === '[DONE]') {
                        onComplete();
                        return;
                    }
                    try {
                        const data = JSON.parse(payload);
                        if (typeof data.error === 'string') {
                            onError(new Error(data.error));
                            return;
                        }
                        if (typeof data.content === 'string') onChunk(data.content);
                    } catch {
                        /* ignore malformed keep-alive lines */
                    }
                }
            }
            onComplete();
        })
        .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            onError(err instanceof Error ? err : new Error(String(err)));
        });
}
