import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BotOff } from 'lucide-react';
import { m } from '@/i18n/messages';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useAgentChat } from '@/state/agentChat';
import { AgentChatView } from './AgentChatView';

// The server assistant: everything server-specific about a conversation, over
// the shared view. Rendered identically by the full page and the dock drawer;
// only the chrome around it differs.

export function AgentChat({ compact = false }: { compact?: boolean }) {
    const server = useServer();
    const everest = useFlags(s => s.everest);
    const queryClient = useQueryClient();

    const loading = useAgentChat(s => s.loading);

    const agentAvailable = Boolean(everest?.ai.enabled && everest.ai.feature_agent);

    // A settled turn may have opened a conversation, or retitled one.
    useEffect(() => {
        if (!loading) {
            void queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-conversations'] });
        }
    }, [loading, queryClient, server.uuid]);

    // Without the agent there is no assistant left to render. This used to fall
    // back to advisory chat, which is exactly the fallback that was cut: a chat
    // that cannot read the server answers confidently about a machine it has
    // never seen. Saying so is the honest end of that decision.
    if (!agentAvailable) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <BotOff className="h-8 w-8 text-[var(--color-ink-faint)]" />
                <p className="text-sm font-medium text-[var(--color-ink)]">
                    {m['server.ai.agentDisabledTitle']()}
                </p>
                <p className="max-w-sm text-xs text-[var(--color-ink-muted)]">
                    {m['server.ai.agentDisabledBody']()}
                </p>
            </div>
        );
    }

    return (
        <AgentChatView
            store={useAgentChat}
            compact={compact}
            confirmPhrase={server.name}
            emptyTitle={m['server.ai.emptyAgentTitle']()}
            emptySubtitle={m['server.ai.emptyAgentSubtitle']({ name: server.name })}
            placeholder={m['server.ai.composerAgentPlaceholder']()}
            disclaimer={m['server.ai.agentDisclaimer']()}
            suggestions={[
                m['server.ai.suggestions.crash'](),
                m['server.ai.suggestions.performance'](),
                m['server.ai.suggestions.config'](),
                m['server.ai.suggestions.mods'](),
            ]}
        />
    );
}
