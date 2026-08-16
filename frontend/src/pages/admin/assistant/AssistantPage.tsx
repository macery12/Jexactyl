import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, TriangleAlert } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { AgentChatView } from '@/components/ai/AgentChatView';
import { useAdminAgentChat } from '@/state/agentChat';
import type { ChatRole } from '@/api/ai';
import {
    deleteAdminAgentConversation,
    endAdminAssist,
    getAdminAgentConversation,
    getAiSettings,
    listAdminAgentConversations,
    type AdminAgentConversation,
} from '@/api/adminAi';

// The admin assistant, as a page of its own at the top of the sidebar.
//
// It began as a tab inside Admin → AI, which put a conversation you might return
// to several times a day three clicks deep, behind a section that is otherwise
// provider configuration and telemetry. Admin → AI is now what its name says;
// this is the thing you actually talk to.
//
// Unlike the server assistant it has no chat/agent toggle: a plain chat about the
// panel's own records cannot read them, so there is nothing for the cheaper path
// to answer.

export default function AssistantPage() {
    const queryClient = useQueryClient();

    const loading = useAdminAgentChat(s => s.loading);
    const conversationId = useAdminAgentChat(s => s.conversationId);
    const newChat = useAdminAgentChat(s => s.newChat);
    const loadTranscript = useAdminAgentChat(s => s.loadTranscript);
    const loadFailed = useAdminAgentChat(s => s.loadFailed);
    const setAssist = useAdminAgentChat(s => s.setAssist);

    // Read from settings rather than the injected feature flags: those are
    // rendered once per page load, so an operator who has just switched the
    // assistant on would be told it is off until they reloaded.
    const { data: settings, isLoading: settingsLoading } = useQuery({
        queryKey: ['admin', 'ai', 'settings'],
        queryFn: getAiSettings,
    });

    const enabled = Boolean(settings?.agent.enabled && settings?.agent.admin_enabled);

    const { data: conversations = [] } = useQuery({
        queryKey: ['admin', 'ai', 'agent-conversations'],
        queryFn: listAdminAgentConversations,
        enabled,
    });

    useEffect(() => {
        if (!loading) {
            void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'agent-conversations'] });
        }
    }, [loading, queryClient]);

    const open = async (id: number) => {
        if (loading) return;

        try {
            const conversation = await getAdminAgentConversation(id);
            loadTranscript(
                conversation.id,
                conversation.messages
                    // The role column can hold `system`, but a turn never writes
                    // one — and a system prompt is not part of the transcript a
                    // person reads back.
                    .filter(message => message.role !== 'system')
                    .map(message => ({
                        role: message.role as ChatRole,
                        content: message.content,
                        tool_name: message.tool_name,
                        tool_call_id: null,
                        tool_calls: null,
                        step: message.step,
                    })),
                conversation.redactions,
            );

            if (conversation.assist) {
                setAssist({
                    serverUuid: conversation.assist.server_uuid,
                    serverName: conversation.assist.server_name,
                    writable: conversation.assist.writable,
                    reason: conversation.assist.reason,
                });
            }
        } catch {
            loadFailed();
        }
    };

    // Ends the session server-side and takes the banner down. The access was
    // being re-checked on every turn anyway; this is so an administrator who has
    // finished can say so and watch it stop, rather than having to trust that
    // opening a new chat was enough.
    const endAssist = async () => {
        if (conversationId === null) {
            setAssist(null);

            return;
        }

        try {
            await endAdminAssist(conversationId);
        } finally {
            setAssist(null);
        }
    };

    const remove = async (id: number) => {
        await deleteAdminAgentConversation(id);
        if (conversationId === id) newChat();
        void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'agent-conversations'] });
    };

    if (settingsLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (!enabled) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--color-border)] px-6 py-16 text-center">
                <TriangleAlert className="h-6 w-6 text-[var(--color-warning)]" />
                <p className="text-sm font-medium text-[var(--color-ink)]">{m['admin.ai.agent.disabledTitle']()}</p>
                <p className="max-w-md text-sm text-[var(--color-ink-muted)]">{m['admin.ai.agent.disabledBody']()}</p>
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-10.5rem)] min-h-[28rem] gap-3">
            <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto lg:flex">
                <Button size="sm" variant="outline" onClick={newChat} disabled={loading} className="mb-1">
                    <Plus className="h-3.5 w-3.5" />
                    {m['server.ai.newChat']()}
                </Button>

                {conversations.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-[var(--color-ink-faint)]">
                        {m['server.ai.historyEmpty']()}
                    </p>
                ) : (
                    conversations.map((conversation: AdminAgentConversation) => (
                        <div
                            key={conversation.id}
                            className={cn(
                                'group flex items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                conversation.id === conversationId
                                    ? 'bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => void open(conversation.id)}
                                className="min-w-0 flex-1 truncate text-left"
                            >
                                {conversation.title}
                            </button>
                            <button
                                type="button"
                                onClick={() => void remove(conversation.id)}
                                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                aria-label={m['common.actions.delete']()}
                            >
                                <span className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]">
                                    ×
                                </span>
                            </button>
                        </div>
                    ))
                )}
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-[var(--color-border)]">
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
                    <Bot className="h-3.5 w-3.5 text-[var(--brand)]" />
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                        {m['admin.ai.agent.title']()}
                    </span>
                </div>

                <AgentChatView
                    store={useAdminAgentChat}
                    // No admin tool is registered at destructive tier, so the
                    // typed-confirmation path is unreachable here. The phrase is
                    // still supplied so the shared card never renders an empty
                    // prompt if that ever changes.
                    confirmPhrase={m['admin.ai.agent.confirmPhrase']()}
                    emptyTitle={m['admin.ai.agent.emptyTitle']()}
                    emptySubtitle={m['admin.ai.agent.emptySubtitle']()}
                    placeholder={m['admin.ai.agent.placeholder']()}
                    disclaimer={m['admin.ai.agent.disclaimer']()}
                    suggestions={[
                        m['admin.ai.agent.suggestCatalogue'](),
                        m['admin.ai.agent.suggestCoupon'](),
                        m['admin.ai.agent.suggestUsers'](),
                        m['admin.ai.agent.suggestTickets'](),
                    ]}
                    onEndAssist={() => void endAssist()}
                />
            </div>
        </div>
    );
}
