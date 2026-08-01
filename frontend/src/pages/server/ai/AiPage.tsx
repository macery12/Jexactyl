import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, PanelLeftClose, PanelLeftOpen, ShieldAlert } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { useServer } from '@/components/server/ServerContext';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { ChatMessage } from '@/components/ai/ChatMessage';
import { ChatComposer } from '@/components/ai/ChatComposer';
import { useChatStream } from '@/components/ai/useChatStream';
import {
    appendMessages,
    createConversation,
    deleteConversation,
    listConversations,
    loadConversation,
    streamServerAiQuery,
    toggleSaveConversation,
    type AiConversation,
} from '@/api/ai';
import { ConversationRail } from './ConversationRail';

// Server AI Assistant — ChatGPT-style chat over the existing
// /api/client/servers/{uuid}/ai SSE endpoint. Conversation history persists
// through the /ai/conversations CRUD (bookmark = keep forever, otherwise a
// rolling 7-day expiry, both enforced server-side).

const RAIL_KEY = 'v2:ai:rail';

export default function AiPage() {
    const server = useServer();
    const user = useSession(s => s.user);
    const everest = useFlags(s => s.everest);

    const isAdmin = Boolean(user?.admin_role_id);
    const assistantEnabled = Boolean(everest?.ai.feature_server_assistant);
    const canUseAssistant = isAdmin || assistantEnabled;

    const queryClient = useQueryClient();
    const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
        queryKey: ['server', server.uuid, 'ai-conversations'],
        queryFn: () => listConversations(server.uuid),
        enabled: canUseAssistant,
    });
    const refreshConversations = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-conversations'] }),
        [queryClient, server.uuid],
    );

    const [activeId, setActiveId] = useState<number | null>(null);
    // The stream callbacks close over state at send time; a ref keeps the
    // persistence target correct even when the id changes mid-stream.
    const activeIdRef = useRef<number | null>(null);
    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== 'closed');
    const toggleRail = () => {
        setRailOpen(open => {
            localStorage.setItem(RAIL_KEY, open ? 'closed' : 'open');
            return !open;
        });
    };

    const persistExchange = useCallback(
        (userContent: string, assistantContent: string) => {
            const messagesToStore = [
                { role: 'user' as const, content: userContent },
                { role: 'assistant' as const, content: assistantContent },
            ];
            const conversationId = activeIdRef.current;
            const persist =
                conversationId !== null
                    ? appendMessages(server.uuid, conversationId, messagesToStore)
                    : createConversation(server.uuid, userContent.slice(0, 80)).then(conv => {
                          setActiveId(conv.id);
                          return appendMessages(server.uuid, conv.id, messagesToStore);
                      });
            void persist.then(refreshConversations).catch(() => undefined);
        },
        [server.uuid, refreshConversations],
    );

    const { messages, setMessages, send, cancel, loading, slowHint } = useChatStream(
        (query, history, callbacks, signal) =>
            streamServerAiQuery(
                server.uuid,
                { query, queryType: 'freeform', conversationId: activeIdRef.current, history },
                callbacks,
                signal,
            ),
        {
            onExchangeComplete: persistExchange,
            cancelledSuffix: `\n\n*${m['server.ai.cancelled']()}*`,
        },
    );

    const bottomRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const [input, setInput] = useState('');

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const startNewChat = () => {
        if (loading) return;
        setActiveId(null);
        setMessages([]);
        setInput('');
        composerRef.current?.focus();
    };

    const openConversation = (conv: AiConversation) => {
        if (loading || conv.id === activeId) return;
        setActiveId(conv.id);
        setMessages([]);
        loadConversation(server.uuid, conv.id)
            .then(({ messages: stored }) => setMessages(stored.map(msg => ({ ...msg }))))
            .catch(() =>
                setMessages([{ role: 'assistant', content: m['server.ai.loadFailed'](), error: true }]),
            );
    };

    const removeConversation = (conv: AiConversation) => {
        void deleteConversation(server.uuid, conv.id)
            .then(() => {
                if (activeId === conv.id) startNewChat();
                return refreshConversations();
            })
            .catch(() => undefined);
    };

    const handleToggleSave = (conv: AiConversation) => {
        void toggleSaveConversation(server.uuid, conv.id)
            .then(refreshConversations)
            .catch(() => undefined);
    };

    const submit = () => {
        send(input);
        setInput('');
    };

    const suggest = (text: string) => {
        if (loading) return;
        send(text);
    };

    if (!canUseAssistant) {
        return (
            <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
                <ShieldAlert className="h-10 w-10 text-[var(--color-ink-faint)]" />
                <p className="text-base font-medium text-[var(--color-ink)]">{m['server.ai.restrictedTitle']()}</p>
                <p className="max-w-md text-sm text-[var(--color-ink-muted)]">{m['server.ai.restrictedBody']()}</p>
            </div>
        );
    }

    const suggestions = [
        m['server.ai.suggestions.crash'](),
        m['server.ai.suggestions.performance'](),
        m['server.ai.suggestions.config'](),
        m['server.ai.suggestions.mods'](),
    ];

    return (
        <div className="flex h-[calc(100vh-10.5rem)] min-h-[420px] gap-3">
            {railOpen && (
                <ConversationRail
                    conversations={conversations}
                    loading={conversationsLoading}
                    activeId={activeId}
                    onNewChat={startNewChat}
                    onOpen={openConversation}
                    onToggleSave={handleToggleSave}
                    onDelete={removeConversation}
                />
            )}

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
                <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
                    <button
                        type="button"
                        onClick={toggleRail}
                        title={railOpen ? m['server.ai.hideHistory']() : m['server.ai.showHistory']()}
                        className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                    </button>
                    <span className="text-sm font-medium text-[var(--color-ink)]">{m['server.ai.title']()}</span>
                    <span className="truncate text-xs text-[var(--color-ink-faint)]">{server.name}</span>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                                <Bot className="h-7 w-7 text-[var(--brand)]" />
                            </div>
                            <div>
                                <p className="text-lg font-semibold text-[var(--color-ink)]">
                                    {m['server.ai.emptyTitle']()}
                                </p>
                                <p className="mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
                                    {m['server.ai.emptySubtitle']({ name: server.name })}
                                </p>
                            </div>
                            <div className="flex max-w-lg flex-wrap justify-center gap-2">
                                {suggestions.map(text => (
                                    <button
                                        key={text}
                                        type="button"
                                        onClick={() => suggest(text)}
                                        className="rounded-full border border-[var(--color-border-strong)] px-3.5 py-1.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)] hover:text-[var(--color-ink)]"
                                    >
                                        {text}
                                    </button>
                                ))}
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
                                slowHint ? 'animate-pulse opacity-100' : 'pointer-events-none opacity-0',
                            )}
                        >
                            {m['server.ai.slowHint']()}
                        </p>
                        <ChatComposer
                            ref={composerRef}
                            value={input}
                            onChange={setInput}
                            onSend={submit}
                            onCancel={cancel}
                            loading={loading}
                            placeholder={m['server.ai.composerPlaceholder']()}
                        />
                        <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-faint)]">
                            {m['server.ai.disclaimer']()}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
