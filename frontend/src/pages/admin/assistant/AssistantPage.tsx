import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen, Sparkles, TriangleAlert } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Spinner } from '@/components/ui/Spinner';
import { AgentChatView } from '@/components/ai/AgentChatView';
import { useFillViewport } from '@/components/ai/useFillViewport';
import { ConversationRail } from '@/components/ai/ConversationRail';
import { DeleteConversationModal } from '@/components/ai/DeleteConversationModal';
import { sessionCounters, type DetailGroup } from '@/components/ai/detailFields';
import { AiLoadError } from '@/pages/admin/ai/LoadError';
import { ADMIN_AGENT_TARGET, useAdminAgentChat } from '@/state/agentChat';
import { useSession } from '@/state/session';
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
//
// The history rail is the shared component. It used to be about seventy lines of
// hand-rolled `<aside>` right here, which had drifted from the server route's
// rail into a different width, a different breakpoint, a `×` glyph for delete,
// and no bookmarks, expiry labels or loading state at all — two accidental
// designs for one thing, neither of them chosen.

const RAIL_KEY = 'v2:admin:ai:rail';

export default function AssistantPage() {
    const queryClient = useQueryClient();
    const user = useSession(s => s.user);
    const fillRef = useFillViewport<HTMLDivElement>();
    const [deleteTarget, setDeleteTarget] = useState<AdminAgentConversation | null>(null);
    const [railOpen, setRailOpen] = useState(
        () => window.matchMedia('(min-width: 1024px)').matches && localStorage.getItem(RAIL_KEY) !== 'closed',
    );

    const loading = useAdminAgentChat(s => s.loading);
    const entries = useAdminAgentChat(s => s.entries);
    const step = useAdminAgentChat(s => s.step);
    const assist = useAdminAgentChat(s => s.assist);
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

    const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
        queryKey: ['admin', 'ai', 'agent-conversations'],
        queryFn: listAdminAgentConversations,
        enabled,
    });

    useEffect(() => {
        if (!loading) {
            void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'agent-conversations'] });
        }
    }, [loading, queryClient]);

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

    const open = async (conversation: AdminAgentConversation) => {
        if (loading) return;

        closeMobileRail();

        const generation = beginTranscriptLoad(ADMIN_AGENT_TARGET, conversation.id);
        try {
            const loaded = await getAdminAgentConversation(conversation.id);
            const applied = loadTranscript(
                ADMIN_AGENT_TARGET,
                loaded.id,
                generation,
                loaded.messages
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
                loaded.redactions,
            );

            if (applied && loaded.assist) {
                setAssist({
                    serverUuid: loaded.assist.server_uuid,
                    serverName: loaded.assist.server_name,
                    writable: loaded.assist.writable,
                    reason: loaded.assist.reason,
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
        closeMobileRail();
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

    const counters = sessionCounters(entries);

    // An assist session is the one thing on this surface that is about somebody
    // else's property, so it leads the column. The banner above the composer
    // still carries the warning and the End control; this says which server,
    // permanently, in the place every other fact about the session lives.
    const detail: DetailGroup[] = [
        {
            label: m['server.ai.detail.groupTarget'](),
            rows: assist
                ? [
                      { label: m['server.ai.detail.server'](), value: assist.serverName },
                      {
                          label: m['server.ai.detail.access'](),
                          value: assist.writable
                              ? m['server.ai.detail.writable']()
                              : m['server.ai.detail.readOnly'](),
                          tone: assist.writable ? 'warn' : 'default',
                      },
                      ...(assist.reason !== ''
                          ? [{ label: m['server.ai.detail.reason'](), value: assist.reason }]
                          : []),
                  ]
                : [],
        },
        {
            label: m['server.ai.detail.groupTurn'](),
            rows: step
                ? [
                      {
                          label: m['server.ai.detail.step'](),
                          value: `${step.step} / ${step.maxSteps}`,
                          meter: step.maxSteps > 0 ? step.step / step.maxSteps : undefined,
                      },
                  ]
                : [],
        },
        {
            label: m['server.ai.detail.groupSession'](),
            rows: [
                { label: m['server.ai.detail.turns'](), value: String(counters.turns) },
                { label: m['server.ai.detail.reads'](), value: String(counters.reads) },
                { label: m['server.ai.detail.changes'](), value: String(counters.changes) },
            ],
        },
    ];

    return (
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
                        assistingId={assist ? conversationId : null}
                        newChatLabel={m['server.ai.newChat']()}
                        onNewChat={() => {
                            newChat();
                            closeMobileRail();
                        }}
                        onOpen={conversation => void open(conversation)}
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
                    <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />
                    <span className="text-[13px] font-medium text-[var(--color-ink)]">
                        {m['admin.ai.agent.title']()}
                    </span>
                </header>

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
                    detail={detail}
                    // Several administrators share this surface, and an assist
                    // session is auditable work on a customer's server — so which
                    // of them asked is information, not decoration. The server
                    // route passes nothing, where it would only ever say "You".
                    speaker={user?.username ?? m['server.ai.you']()}
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
