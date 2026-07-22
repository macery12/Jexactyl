import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiStreamCallbacks } from '@/lib/aiStream';
import type { ChatMessageData } from './ChatMessage';

// Shared streaming state machine for the server assistant and the admin
// playground: appends a user turn + an empty streaming assistant turn, feeds
// chunks into the tail message, supports cancel, and raises a "slow" hint
// when no token arrives within 5s (an Ollama cold start).

export type StartStream = (
    query: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    callbacks: AiStreamCallbacks,
    signal: AbortSignal,
) => void;

const SLOW_HINT_MS = 5000;
const HISTORY_DEPTH = 10;

export function useChatStream(
    startStream: StartStream,
    opts?: {
        onExchangeComplete?: (userContent: string, assistantContent: string) => void;
        cancelledSuffix?: string;
    },
) {
    const [messages, setMessages] = useState<ChatMessageData[]>([]);
    const [loading, setLoading] = useState(false);
    const [slowHint, setSlowHint] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<{ user: string; assistant: string } | null>(null);
    // Kept in a ref so the completion callback persists against the latest handler.
    const onCompleteRef = useRef(opts?.onExchangeComplete);
    useEffect(() => {
        onCompleteRef.current = opts?.onExchangeComplete;
    });
    const cancelledSuffix = opts?.cancelledSuffix;

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
            if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
        };
    }, []);

    const settle = useCallback(() => {
        setLoading(false);
        setSlowHint(false);
        if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
        abortRef.current = null;
    }, []);

    const patchTail = useCallback((patch: (last: ChatMessageData) => ChatMessageData) => {
        setMessages(curr => {
            const next = [...curr];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') next[next.length - 1] = patch(last);
            return next;
        });
    }, []);

    const send = useCallback(
        (query: string) => {
            const q = query.trim();
            if (!q || loading) return;

            pendingRef.current = { user: q, assistant: '' };
            setSlowHint(false);
            if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
            slowTimerRef.current = setTimeout(() => setSlowHint(true), SLOW_HINT_MS);

            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            setMessages(prev => {
                const history = prev
                    .filter(msg => !msg.streaming && !msg.error && msg.content.length > 0)
                    .slice(-HISTORY_DEPTH)
                    .map(msg => ({ role: msg.role, content: msg.content }));

                startStream(
                    q,
                    history,
                    {
                        onChunk: chunk => {
                            setSlowHint(false);
                            if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
                            if (pendingRef.current) pendingRef.current.assistant += chunk;
                            patchTail(last => ({ ...last, content: last.content + chunk }));
                        },
                        onComplete: () => {
                            patchTail(last => ({ ...last, streaming: false }));
                            settle();
                            const exchange = pendingRef.current;
                            pendingRef.current = null;
                            if (exchange && exchange.assistant) {
                                onCompleteRef.current?.(exchange.user, exchange.assistant);
                            }
                        },
                        onError: error => {
                            patchTail(last => ({
                                ...last,
                                content: error.message,
                                streaming: false,
                                error: true,
                            }));
                            settle();
                            pendingRef.current = null;
                        },
                    },
                    controller.signal,
                );

                return [...prev, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true }];
            });

            setLoading(true);
        },
        [loading, startStream, patchTail, settle],
    );

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        settle();
        pendingRef.current = null;
        patchTail(last =>
            last.streaming
                ? { ...last, content: last.content + (cancelledSuffix ?? ''), streaming: false }
                : last,
        );
    }, [settle, patchTail, cancelledSuffix]);

    return { messages, setMessages, send, cancel, loading, slowHint };
}
