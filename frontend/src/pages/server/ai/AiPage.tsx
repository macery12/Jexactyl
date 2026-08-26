import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen, ShieldAlert } from 'lucide-react';
import { m } from '@/i18n/messages';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useAgentChat } from '@/state/agentChat';
import { useFlashes } from '@/state/flashes';
import { AgentChat } from '@/components/ai/AgentChat';
import { useFillViewport } from '@/components/ai/useFillViewport';
import { ConversationRail } from '@/components/ai/ConversationRail';
import { DeleteConversationModal } from '@/components/ai/DeleteConversationModal';
import {
    deleteConversation,
    listConversations,
    loadConversation,
    toggleSaveConversation,
    type AiConversation,
} from '@/api/ai';

// The full-page assistant: history rail plus the shared conversation view.
//
// Chat state lives in the agent store rather than here, so a turn started in
// the dock drawer is the same turn this page shows — and navigating away
// mid-turn does not abandon it.
//
// The rail is the shared component rather than one of its own. It used to be a
// local file that the admin assistant had a second, divergent copy of; the
// grouping, the bookmarks and the expiry labels are now the same code on both
// routes, which is the only way they stay the same design.

const RAIL_KEY = 'v2:ai:rail';

export default function AiPage() {
    const server = useServer();
    const everest = useFlags(s => s.everest);
    const fillRef = useFillViewport<HTMLDivElement>();

    const canUseAssistant = Boolean(everest?.ai.enabled && everest.ai.feature_agent);

    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);
    const conversationId = useAgentChat(s => s.conversationId);
    const loading = useAgentChat(s => s.loading);
    const bind = useAgentChat(s => s.bind);
    const newChat = useAgentChat(s => s.newChat);
    const beginTranscriptLoad = useAgentChat(s => s.beginTranscriptLoad);
    const loadTranscript = useAgentChat(s => s.loadTranscript);
    const loadFailed = useAgentChat(s => s.loadFailed);
    const setDrawer = useAgentChat(s => s.setDrawer);
    const resumeActive = useAgentChat(s => s.resumeActive);

    useEffect(() => {
        if (!canUseAssistant) return;

        bind(server.uuid);
        // The page and the drawer are two views of one conversation; showing
        // both at once would be redundant and fight for scroll.
        setDrawer(false);

        // Landing here directly — a reload, a bookmark, a link — is exactly the
        // case that used to show an empty page while a turn was still running.
        resumeActive();
    }, [bind, canUseAssistant, resumeActive, setDrawer, server.uuid]);

    const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
        queryKey: ['server', server.uuid, 'ai-conversations'],
        queryFn: () => listConversations(server.uuid),
        enabled: canUseAssistant,
    });

    const refreshConversations = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-conversations'] }),
        [queryClient, server.uuid],
    );

    const [railOpen, setRailOpen] = useState(
        () => window.matchMedia('(min-width: 1024px)').matches && localStorage.getItem(RAIL_KEY) !== 'closed',
    );
    const [deleteTarget, setDeleteTarget] = useState<AiConversation | null>(null);

    const desktopRail = () => window.matchMedia('(min-width: 1024px)').matches;
    const toggleRail = () => {
        setRailOpen(open => {
            if (desktopRail()) localStorage.setItem(RAIL_KEY, open ? 'closed' : 'open');
            return !open;
        });
    };
    const closeMobileRail = () => {
        if (!desktopRail()) setRailOpen(false);
    };

    const openConversation = (conv: AiConversation) => {
        if (loading || conv.id === conversationId) return;

        const target = server.uuid;
        const generation = beginTranscriptLoad(target, conv.id);
        loadConversation(server.uuid, conv.id)
            .then(({ messages, redactions }) => loadTranscript(target, conv.id, generation, messages, redactions))
            .catch(() => loadFailed(target, generation));
        closeMobileRail();
    };

    const removeConversation = async (conv: AiConversation) => {
        await deleteConversation(server.uuid, conv.id);
        if (conversationId === conv.id) newChat();
        await refreshConversations();
        closeMobileRail();
    };

    const handleToggleSave = (conv: AiConversation) => {
        void toggleSaveConversation(server.uuid, conv.id)
            .then(refreshConversations)
            .catch(() => push({ type: 'error', message: m['common.states.genericError']() }));
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
        // Fills whatever the layout gives it instead of guessing the shell's
        // chrome height. `h-[calc(100vh-10.5rem)]` was a hardcoded assumption
        // that broke the moment a banner appeared above it, leaving either dead
        // space or a second scrollbar.
        <div
            ref={fillRef}
            className="relative flex overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70"
        >
            {railOpen && (
                <>
                    <button
                        type="button"
                        aria-label={m['server.ai.hideHistory']()}
                        onClick={() => setRailOpen(false)}
                        className="absolute inset-0 z-10 bg-black/50 lg:hidden"
                    />
                    <ConversationRail
                        conversations={conversations}
                        loading={conversationsLoading}
                        activeId={conversationId}
                        newChatLabel={m['server.ai.newChat']()}
                        onNewChat={() => {
                            newChat();
                            closeMobileRail();
                        }}
                        onOpen={openConversation}
                        onToggleSave={handleToggleSave}
                        onDelete={setDeleteTarget}
                        onClose={() => setRailOpen(false)}
                        className="absolute inset-y-0 left-0 z-20 w-[min(14rem,calc(100%-3rem))] shadow-2xl lg:static lg:z-auto lg:w-56 lg:shadow-none"
                    />
                </>
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-border-strong)] px-3">
                    <button
                        type="button"
                        onClick={toggleRail}
                        title={railOpen ? m['server.ai.hideHistory']() : m['server.ai.showHistory']()}
                        className="rounded-sm p-1 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        {railOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-[13px] font-medium text-[var(--color-ink)]">{m['server.ai.title']()}</span>
                    <span className="truncate text-[11.5px] text-[var(--color-ink-faint)]">{server.name}</span>
                </header>

                <AgentChat />
            </div>

            {deleteTarget && (
                <DeleteConversationModal
                    title={deleteTarget.title}
                    onClose={() => setDeleteTarget(null)}
                    onDelete={() => removeConversation(deleteTarget)}
                />
            )}
        </div>
    );
}
