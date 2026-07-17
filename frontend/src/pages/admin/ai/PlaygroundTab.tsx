import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { ChatMessage } from '@/components/ai/ChatMessage';
import { ChatComposer } from '@/components/ai/ChatComposer';
import { useChatStream } from '@/components/ai/useChatStream';
import { getAiSettings, streamAdminAiQuery } from '@/api/adminAi';

// Admin chat console — a stateless playground for testing the configured
// provider (no conversation persistence; the admin query endpoint is
// single-turn by design).
export function PlaygroundTab() {
    const { data: settings } = useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: getAiSettings });

    const { messages, send, cancel, loading, slowHint } = useChatStream(
        (query, _history, callbacks, signal) => streamAdminAiQuery(query, callbacks, signal),
        { cancelledSuffix: `\n\n*${m['server.ai.cancelled']()}*` },
    );

    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const submit = () => {
        send(input);
        setInput('');
    };

    return (
        <div className="flex h-[calc(100vh-21rem)] min-h-[380px] flex-col overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <div className="min-h-0 flex-1 overflow-y-auto">
                {messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                            <Bot className="h-6 w-6 text-[var(--brand)]" />
                        </div>
                        <div>
                            <p className="text-base font-semibold text-[var(--color-ink)]">
                                {m['admin.ai.playground.emptyTitle']()}
                            </p>
                            <p className="mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
                                {m['admin.ai.playground.emptySubtitle']({ model: settings?.model ?? '—' })}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5">
                        {messages.map((msg, i) => (
                            <ChatMessage key={i} message={msg} />
                        ))}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            <div className="shrink-0 px-4 pb-3 pt-1">
                <div className="mx-auto w-full max-w-3xl">
                    <p
                        className={cn(
                            'mb-1.5 text-center text-xs text-[var(--color-ink-faint)] transition-opacity',
                            slowHint && settings?.mode === 'ollama'
                                ? 'animate-pulse opacity-100'
                                : 'pointer-events-none opacity-0',
                        )}
                    >
                        {m['server.ai.slowHint']()}
                    </p>
                    <ChatComposer
                        value={input}
                        onChange={setInput}
                        onSend={submit}
                        onCancel={cancel}
                        loading={loading}
                        placeholder={m['admin.ai.playground.placeholder']()}
                    />
                    <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-faint)]">
                        {m['admin.ai.playground.disclaimer']()}
                    </p>
                </div>
            </div>
        </div>
    );
}
