import { Bookmark, Plus, Trash2 } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import type { AiConversation } from '@/api/ai';

// ChatGPT-style history rail: new-chat button on top, then the conversation
// list. Unsaved chats show their expiry; the bookmark toggle keeps a chat
// forever. Delete + bookmark reveal on hover like the V1 sidebar.
export function ConversationRail({
    conversations,
    loading,
    activeId,
    onNewChat,
    onOpen,
    onToggleSave,
    onDelete,
}: {
    conversations: AiConversation[];
    loading: boolean;
    activeId: number | null;
    onNewChat: () => void;
    onOpen: (conversation: AiConversation) => void;
    onToggleSave: (conversation: AiConversation) => void;
    onDelete: (conversation: AiConversation) => void;
}) {
    return (
        <div className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <div className="p-2">
                <button
                    type="button"
                    onClick={onNewChat}
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                    <Plus className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />
                    {m['server.ai.newChat']()}
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {loading && (
                    <div className="flex justify-center py-6">
                        <Spinner className="h-4 w-4" />
                    </div>
                )}
                {!loading && conversations.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-[var(--color-ink-faint)]">
                        {m['server.ai.historyEmpty']()}
                    </p>
                )}
                {conversations.map(conv => (
                    <div
                        key={conv.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpen(conv)}
                        onKeyDown={e => e.key === 'Enter' && onOpen(conv)}
                        className={cn(
                            'group flex cursor-pointer flex-col rounded-lg px-2.5 py-2 transition-colors',
                            activeId === conv.id
                                ? 'bg-[var(--brand-soft)]'
                                : 'hover:bg-[var(--color-surface-2)]',
                        )}
                    >
                        <div className="flex items-center gap-1">
                            <span
                                className={cn(
                                    'min-w-0 flex-1 truncate text-xs',
                                    activeId === conv.id
                                        ? 'font-medium text-[var(--color-ink)]'
                                        : 'text-[var(--color-ink-muted)]',
                                )}
                            >
                                {conv.title}
                            </span>
                            <button
                                type="button"
                                onClick={e => {
                                    e.stopPropagation();
                                    onToggleSave(conv);
                                }}
                                title={conv.is_saved ? m['server.ai.unsaveChat']() : m['server.ai.saveChat']()}
                                className={cn(
                                    'shrink-0 rounded p-0.5 transition-opacity hover:text-[var(--brand)]',
                                    conv.is_saved
                                        ? 'text-[var(--brand)] opacity-100'
                                        : 'text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100',
                                )}
                            >
                                <Bookmark className={cn('h-3.5 w-3.5', conv.is_saved && 'fill-current')} />
                            </button>
                            <button
                                type="button"
                                onClick={e => {
                                    e.stopPropagation();
                                    onDelete(conv);
                                }}
                                title={m['common.actions.delete']()}
                                className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {!conv.is_saved && conv.expires_at && (
                            <span className="mt-0.5 text-[10px] text-[var(--color-ink-faint)]">
                                {m['server.ai.expires']({ date: new Date(conv.expires_at).toLocaleDateString() })}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
