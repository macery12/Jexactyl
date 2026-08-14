import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen, ShieldAlert } from 'lucide-react';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { useAgentChat } from '@/state/agentChat';
import { AgentChat } from '@/components/ai/AgentChat';
import {
    deleteConversation,
    listConversations,
    loadConversation,
    toggleSaveConversation,
    type AiConversation,
} from '@/api/ai';
import { ConversationRail } from './ConversationRail';

// The full-page assistant: history rail plus the shared conversation view.
//
// Chat state lives in the agent store rather than here, so a turn started in
// the dock drawer is the same turn this page shows — and navigating away
// mid-turn does not abandon it.

const RAIL_KEY = 'v2:ai:rail';

export default function AiPage() {
    const server = useServer();
    const user = useSession(s => s.user);
    const everest = useFlags(s => s.everest);

    const isAdmin = Boolean(user?.admin_role_id);
    const canUseAssistant = isAdmin || Boolean(everest?.ai.feature_server_assistant);

    const queryClient = useQueryClient();
    const conversationId = useAgentChat(s => s.conversationId);
    const loading = useAgentChat(s => s.loading);
    const bind = useAgentChat(s => s.bind);
    const newChat = useAgentChat(s => s.newChat);
    const loadTranscript = useAgentChat(s => s.loadTranscript);
    const loadFailed = useAgentChat(s => s.loadFailed);
    const setDrawer = useAgentChat(s => s.setDrawer);

    useEffect(() => {
        bind(server.uuid);
        // The page and the drawer are two views of one conversation; showing
        // both at once would be redundant and fight for scroll.
        setDrawer(false);
    }, [bind, setDrawer, server.uuid]);

    const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
        queryKey: ['server', server.uuid, 'ai-conversations'],
        queryFn: () => listConversations(server.uuid),
        enabled: canUseAssistant,
    });

    const refreshConversations = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-conversations'] }),
        [queryClient, server.uuid],
    );

    const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== 'closed');
    const toggleRail = () => {
        setRailOpen(open => {
            localStorage.setItem(RAIL_KEY, open ? 'closed' : 'open');
            return !open;
        });
    };

    const openConversation = (conv: AiConversation) => {
        if (loading || conv.id === conversationId) return;

        loadConversation(server.uuid, conv.id)
            .then(({ messages, redactions }) => loadTranscript(conv.id, messages, redactions))
            .catch(() => loadFailed());
    };

    const removeConversation = (conv: AiConversation) => {
        void deleteConversation(server.uuid, conv.id)
            .then(() => {
                if (conversationId === conv.id) newChat();
                return refreshConversations();
            })
            .catch(() => undefined);
    };

    const handleToggleSave = (conv: AiConversation) => {
        void toggleSaveConversation(server.uuid, conv.id).then(refreshConversations).catch(() => undefined);
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

    return (
        <div className="flex h-[calc(100vh-10.5rem)] min-h-[420px] gap-3">
            {railOpen && (
                <ConversationRail
                    conversations={conversations}
                    loading={conversationsLoading}
                    activeId={conversationId}
                    onNewChat={newChat}
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

                <AgentChat />
            </div>
        </div>
    );
}
