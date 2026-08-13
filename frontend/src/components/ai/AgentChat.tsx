import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useAgentChat } from '@/state/agentChat';
import { listPendingActions } from '@/api/ai';
import { AgentChatView, orphanedPending } from './AgentChatView';
import { ModeToggle } from './ModeToggle';

// The server assistant: everything server-specific about a conversation, over
// the shared view. Rendered identically by the full page and the dock drawer;
// only the chrome around it differs.

export function AgentChat({ compact = false }: { compact?: boolean }) {
    const server = useServer();
    const everest = useFlags(s => s.everest);
    const queryClient = useQueryClient();

    const entries = useAgentChat(s => s.entries);
    const loading = useAgentChat(s => s.loading);
    const mode = useAgentChat(s => s.mode);
    const setMode = useAgentChat(s => s.setMode);

    const agentAvailable = Boolean(everest?.ai.feature_agent);
    const agentMode = mode === 'agent' && agentAvailable;

    // An approval the user left unanswered on a previous visit. Polled rather
    // than pushed: it changes at human speed, and the window is 30 minutes.
    const { data: pendingActions = [] } = useQuery({
        queryKey: ['server', server.uuid, 'ai-pending'],
        queryFn: () => listPendingActions(server.uuid),
        enabled: agentAvailable,
        refetchInterval: 60_000,
    });

    // The queue and the pending list both move when a turn settles.
    useEffect(() => {
        if (!loading) {
            void queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-pending'] });
            void queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-conversations'] });
        }
    }, [loading, queryClient, server.uuid]);

    return (
        <AgentChatView
            store={useAgentChat}
            compact={compact}
            confirmPhrase={server.name}
            emptyTitle={agentMode ? m['server.ai.emptyAgentTitle']() : m['server.ai.emptyTitle']()}
            emptySubtitle={
                agentMode
                    ? m['server.ai.emptyAgentSubtitle']({ name: server.name })
                    : m['server.ai.emptySubtitle']({ name: server.name })
            }
            placeholder={
                agentMode ? m['server.ai.composerAgentPlaceholder']() : m['server.ai.composerPlaceholder']()
            }
            disclaimer={agentMode ? m['server.ai.agentDisclaimer']() : m['server.ai.disclaimer']()}
            suggestions={[
                m['server.ai.suggestions.crash'](),
                m['server.ai.suggestions.performance'](),
                m['server.ai.suggestions.config'](),
                m['server.ai.suggestions.mods'](),
            ]}
            orphaned={orphanedPending(pendingActions, entries)}
            header={
                <ModeToggle
                    mode={mode}
                    onChange={setMode}
                    agentAvailable={agentAvailable}
                    disabled={loading}
                />
            }
        />
    );
}
