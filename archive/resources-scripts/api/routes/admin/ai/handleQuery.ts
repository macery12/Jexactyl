import http from '@/api/http';

// Get CSRF token from cookie
const getCSRFToken = (): string | null => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; XSRF-TOKEN=`);
    if (parts.length === 2) {
        const token = parts.pop()?.split(';').shift();
        return token ? decodeURIComponent(token) : null;
    }
    return null;
};

// Rate limiting: track last query time
let lastQueryTime = 0;
const MIN_QUERY_INTERVAL = 2000; // 2 seconds between queries

export const handleQuery = (query: string, signal?: AbortSignal): Promise<string> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/application/ai/query`, { query, stream: true }, { signal })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const handleQueryStream = (
    query: string,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
    signal?: AbortSignal,
): void => {
    // Rate limiting check
    const now = Date.now();
    if (now - lastQueryTime < MIN_QUERY_INTERVAL) {
        onError(new Error('Please wait a moment before sending another query.'));
        return;
    }
    lastQueryTime = now;

    const csrfToken = getCSRFToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Requested-With': 'XMLHttpRequest',
    };

    if (csrfToken) {
        headers['X-XSRF-TOKEN'] = csrfToken;
    }

    fetch('/api/application/ai/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, stream: true }),
        credentials: 'same-origin',
        signal,
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            if (!response.body) {
                throw new Error('Response body is null');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            const readStream = (): Promise<void> => {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        onComplete();
                        return;
                    }

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.substring(6);
                            if (data === '[DONE]') {
                                onComplete();
                                return;
                            }
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.content) {
                                    onChunk(parsed.content);
                                } else if (parsed.error) {
                                    onError(new Error(parsed.error));
                                    return;
                                }
                            } catch (e) {
                                // Ignore parse errors for incomplete chunks
                            }
                        }
                    }

                    return readStream();
                });
            };

            return readStream();
        })
        .catch(error => {
            if (error.name === 'AbortError') {
                // Request was cancelled
                return;
            }
            onError(error);
        });
};
