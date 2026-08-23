import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, PanelLeftOpen, Plus, TriangleAlert, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { AgentChatView } from '@/components/ai/AgentChatView';
import { DeleteConversationModal } from '@/components/ai/DeleteConversationModal';
import { AiLoadError } from '@/pages/admin/ai/LoadError';
import { ADMIN_AGENT_TARGET, useAdminAgentChat } from '@/state/agentChat';
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
    const [historyOpen, setHistoryOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<AdminAgentConversation | null>(null);

    const loading = useAdminAgentChat(s => s.loading);
    const conversationId = useAdminAgentChat(s => s.conversationId);
    const newChat = useAdminAgentChat(s => s.newChat);
    const beginTranscriptLoad = useAdminAgentChat(s => s.beginTranscriptLoad);
    const loadTranscript = useAdminAgentChat(s => s.loadTranscript);
    const loadFailed = useAdminAgentChat(s => s.loadFailed);
    const setAssist = useAdminAgentChat(s => s.setAssist);

    // Read from settings rather than the injected feature flags: those are
    // rendered once per page load, so an operator who has just switched the
    // assistant on would be told it is off until they reloaded.
    const {
        data: settings,
        isLoading: settingsLoading,
        isError: settingsError,
        refetch: refetchSettings,
    } = useQuery({
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

        const generation = beginTranscriptLoad(ADMIN_AGENT_TARGET, id);
        try {
            const conversation = await getAdminAgentConversation(id);
            const applied = loadTranscript(
                ADMIN_AGENT_TARGET,
                conversation.id,
                generation,
                conversation.messages
                    // The role column can hold `system`, but a turn never writes
                    // one — and a system prompt is not part of the transcript a
                    // person reads back.
                    .filter(message => message.role !== 'system')
                    // Passed through whole. Nulling the call id and arguments
                    // here is what made a reopened transcript show every tool
                    // row with empty arguments and a synthetic id, so two
                    // parallel calls to the same tool became one indistinct
                    // pair — on the surface where the audit matters most.
                    .map(message => ({
                        role: message.role as ChatRole,
                        content: message.content,
                        tool_name: message.tool_name,
                        tool_call_id: message.tool_call_id,
                        tool_calls: message.tool_calls,
                        step: message.step,
                    })),
                conversation.redactions,
            );

            if (applied && conversation.assist) {
                setAssist({
                    serverUuid: conversation.assist.server_uuid,
                    serverName: conversation.assist.server_name,
                    writable: conversation.assist.writable,
                    reason: conversation.assist.reason,
                });
            }
        } catch {
            loadFailed(ADMIN_AGENT_TARGET, generation);
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

    const remove = async (conversation: AdminAgentConversation) => {
        await deleteAdminAgentConversation(conversation.id);
        if (conversationId === conversation.id) newChat();
        await queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'agent-conversations'] });
        setHistoryOpen(false);
    };

    if (settingsLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (settingsError) {
        return <AiLoadError onRetry={() => void refetchSettings()} />;
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
        <div className="relative flex h-[calc(100vh-10.5rem)] min-h-[28rem] gap-3 overflow-hidden">
            {historyOpen && (
                <button
                    type="button"
                    aria-label={m['server.ai.hideHistory']()}
                    onClick={() => setHistoryOpen(false)}
                    className="absolute inset-0 z-10 bg-black/50 lg:hidden"
                />
            )}
            <aside
                className={cn(
                    'w-[min(16rem,calc(100%-3rem))] shrink-0 flex-col gap-1 overflow-y-auto bg-[var(--color-surface)] p-2',
                    'absolute inset-y-0 left-0 z-20 rounded-lg border border-[var(--color-border-strong)] shadow-2xl lg:static lg:flex lg:w-56 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
                    historyOpen ? 'flex' : 'hidden lg:flex',
                )}
            >
                <div className="mb-1 flex gap-1">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            newChat();
                            setHistoryOpen(false);
                        }}
                        disabled={loading}
                        className="flex-1"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {m['server.ai.newChat']()}
                    </Button>
                    <button
                        type="button"
                        onClick={() => setHistoryOpen(false)}
                        title={m['server.ai.hideHistory']()}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] lg:hidden"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

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
                                onClick={() => {
                                    void open(conversation.id);
                                    setHistoryOpen(false);
                                }}
                                className="min-w-0 flex-1 truncate text-left"
                            >
                                {conversation.title}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(conversation)}
                                className="shrink-0 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
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
                    <button
                        type="button"
                        onClick={() => setHistoryOpen(true)}
                        title={m['server.ai.showHistory']()}
                        className="-ml-1 rounded-md p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] lg:hidden"
                    >
                        <PanelLeftOpen className="h-4 w-4" />
                    </button>
                    <Bot className="h-3.5 w-3.5 text-[var(--brand)]" />
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                        {m['admin.ai.agent.title']()}
                    </span>
                </div>

                <AgentChatView
                    store={useAdminAgentChat}
                    // Destructive assist cards carry their live server name in
                    // the approval preview. This fallback is used only for a
                    // future destructive admin action without a server target.
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

            {deleteTarget && (
                <DeleteConversationModal
                    title={deleteTarget.title}
                    onClose={() => setDeleteTarget(null)}
                    onDelete={() => remove(deleteTarget)}
                />
            )}
        </div>
    );
}
