import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useAgentChat } from '@/state/agentChat';
import { listPendingActions } from '@/api/ai';
import { ChatComposer } from './ChatComposer';
import { ChatMarkdown } from './ChatMarkdown';
import { ToolCallRow } from './ToolCallRow';
import { ApprovalCard } from './ApprovalCard';
import { QueueBanner } from './QueueBanner';
import { PendingBanner } from './PendingBanner';
import { ModeToggle } from './ModeToggle';

// The conversation itself — transcript, composer, and the cards a turn can
// produce. Rendered identically by the full page and the dock drawer; only the
// chrome around it differs, so there is one implementation of the hard parts.

export function AgentChat({ compact = false }: { compact?: boolean }) {
    const server = useServer();
    const everest = useFlags(s => s.everest);
    const queryClient = useQueryClient();

    const entries = useAgentChat(s => s.entries);
    const loading = useAgentChat(s => s.loading);
    const queue = useAgentChat(s => s.queue);
    const step = useAgentChat(s => s.step);
    const slowHint = useAgentChat(s => s.slowHint);
    const mode = useAgentChat(s => s.mode);
    const setMode = useAgentChat(s => s.setMode);
    const send = useAgentChat(s => s.send);
    const cancel = useAgentChat(s => s.cancel);
    const decide = useAgentChat(s => s.decide);
    const restorePending = useAgentChat(s => s.restorePending);

    const agentAvailable = Boolean(everest?.ai.feature_agent);

    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);

    // An approval the user left unanswered on a previous visit. Polled rather
    // than pushed: it changes at human speed, and the window is 30 minutes.
    const { data: pendingActions = [] } = useQuery({
        queryKey: ['server', server.uuid, 'ai-pending'],
        queryFn: () => listPendingActions(server.uuid),
        enabled: agentAvailable,
        refetchInterval: 60_000,
    });

    const openApprovals = new Set(
        entries
            .filter(entry => entry.kind === 'approval' && !entry.decision)
            .map(entry => (entry.kind === 'approval' ? entry.turnId : '')),
    );
    const orphaned = pendingActions.filter(action => !openApprovals.has(action.turn_id));

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [entries, queue]);

    // The queue and the pending list both move when a turn settles.
    useEffect(() => {
        if (!loading) {
            void queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-pending'] });
            void queryClient.invalidateQueries({ queryKey: ['server', server.uuid, 'ai-conversations'] });
        }
    }, [loading, queryClient, server.uuid]);

    const submit = useCallback(() => {
        send(input);
        setInput('');
    }, [input, send]);

    const suggestions = [
        m['server.ai.suggestions.crash'](),
        m['server.ai.suggestions.performance'](),
        m['server.ai.suggestions.config'](),
        m['server.ai.suggestions.mods'](),
    ];

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                {entries.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                            <Bot className="h-7 w-7 text-[var(--brand)]" />
                        </div>
                        <div>
                            <p className="text-lg font-semibold text-[var(--color-ink)]">
                                {mode === 'agent' && agentAvailable
                                    ? m['server.ai.emptyAgentTitle']()
                                    : m['server.ai.emptyTitle']()}
                            </p>
                            <p className="mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
                                {mode === 'agent' && agentAvailable
                                    ? m['server.ai.emptyAgentSubtitle']({ name: server.name })
                                    : m['server.ai.emptySubtitle']({ name: server.name })}
                            </p>
                        </div>
                        {!compact && (
                            <div className="flex max-w-lg flex-wrap justify-center gap-2">
                                {suggestions.map(text => (
                                    <button
                                        key={text}
                                        type="button"
                                        onClick={() => !loading && send(text)}
                                        className="rounded-full border border-[var(--color-border-strong)] px-3.5 py-1.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)] hover:text-[var(--color-ink)]"
                                    >
                                        {text}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div
                        className={cn(
                            'mx-auto flex w-full flex-col gap-4 px-4 py-5',
                            compact ? 'max-w-none' : 'max-w-3xl',
                        )}
                    >
                        {entries.map(entry => {
                            if (entry.kind === 'user') {
                                return (
                                    <div key={entry.key} className="flex justify-end">
                                        <div
                                            className="max-w-[85%] whitespace-pre-wrap break-words bg-[var(--color-surface-2)] px-4 py-2.5 text-sm leading-relaxed text-[var(--color-ink)]"
                                            style={{ borderRadius: 'var(--radius-card)' }}
                                        >
                                            {entry.content}
                                        </div>
                                    </div>
                                );
                            }

                            if (entry.kind === 'tool') {
                                return <ToolCallRow key={entry.key} entry={entry} />;
                            }

                            if (entry.kind === 'approval') {
                                return (
                                    <ApprovalCard
                                        key={entry.key}
                                        entry={entry}
                                        serverName={server.name}
                                        disabled={loading}
                                        onDecide={(decision, confirmation) =>
                                            decide(entry.turnId, decision, confirmation)
                                        }
                                    />
                                );
                            }

                            return (
                                <div key={entry.key} className="group flex gap-3">
                                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)]">
                                        <Bot className="h-4 w-4 text-[var(--brand)]" />
                                    </div>
                                    <div
                                        className={cn(
                                            'min-w-0 flex-1',
                                            entry.error && 'text-[var(--color-danger)]',
                                        )}
                                    >
                                        <ChatMarkdown content={entry.content} />
                                        {entry.streaming && (
                                            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-[var(--brand)] align-text-bottom" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {queue && <QueueBanner queue={queue} />}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            <div className="shrink-0 px-4 pb-3 pt-1">
                <div className={cn('mx-auto w-full', compact ? 'max-w-none' : 'max-w-3xl')}>
                    {orphaned.length > 0 && (
                        <div className="mb-2 flex flex-col gap-2">
                            {orphaned.map(action => (
                                <PendingBanner
                                    key={action.turn_id}
                                    action={action}
                                    onReview={() =>
                                        restorePending({
                                            turnId: action.turn_id,
                                            tool: action.tool,
                                            args: action.arguments,
                                            risk: action.risk,
                                            preview: action.preview,
                                        })
                                    }
                                />
                            ))}
                        </div>
                    )}

                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <ModeToggle
                            mode={mode}
                            onChange={setMode}
                            agentAvailable={agentAvailable}
                            disabled={loading}
                        />

                        <span className="truncate text-xs text-[var(--color-ink-faint)]">
                            {loading && step
                                ? m['server.ai.stepOf']({ step: step.step, total: step.maxSteps })
                                : slowHint
                                  ? m['server.ai.slowHint']()
                                  : ''}
                        </span>
                    </div>

                    <ChatComposer
                        ref={composerRef}
                        value={input}
                        onChange={setInput}
                        onSend={submit}
                        onCancel={cancel}
                        loading={loading}
                        placeholder={
                            mode === 'agent' && agentAvailable
                                ? m['server.ai.composerAgentPlaceholder']()
                                : m['server.ai.composerPlaceholder']()
                        }
                    />

                    <p className="mt-1.5 text-center text-[11px] text-[var(--color-ink-faint)]">
                        {mode === 'agent' && agentAvailable
                            ? m['server.ai.agentDisclaimer']()
                            : m['server.ai.disclaimer']()}
                    </p>
                </div>
            </div>
        </div>
    );
}
