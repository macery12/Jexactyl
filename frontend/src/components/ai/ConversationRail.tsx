import { Bookmark, Plus, Trash2, X } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';

// The conversation history, grouped.
//
// One component for both assistants. It used to be two: this one, and a
// hand-rolled `<aside>` inside the admin page that had drifted into a different
// width, a different radius, a different breakpoint, a `×` glyph instead of a
// trash icon, and no bookmarks, expiry or loading state at all. Two accidental
// designs for one thing is not a decision anybody made; it is what happens when
// a surface is copied instead of shared.
//
// Grouping is what makes it more than a list. An open assist session — a
// conversation being held inside a customer's server — is the one chat you must
// never lose track of, so it is lifted out of chronological order into its own
// group. Saved chats come next because they were deliberately kept; everything
// else is recent, and says when it expires.
//
// The hover-revealed controls carry `pointer-events-none` while hidden, which is
// not tidying. `opacity-0` alone leaves them fully hit-testable: they hold their
// layout box at the right edge of every row and call `stopPropagation()`, so a
// click landing there was swallowed — the row would not open, and the second
// click, now that hovering had faded them in, could delete the conversation
// instead. That was the "history needs a double-click" bug, and an invisible
// delete button fourteen pixels from where people click to open things.
//
// `focus-visible` re-enables them for the keyboard, which the opacity rule alone
// had made unreachable.

/** The fields both assistants' conversation shapes already share. */
export interface RailConversation {
    id: number;
    title: string;
    is_saved: boolean;
    expires_at: string | null;
}

export function ConversationRail<T extends RailConversation>({
    conversations,
    loading = false,
    activeId,
    assistingId = null,
    onNewChat,
    onOpen,
    onToggleSave,
    onDelete,
    onClose,
    newChatLabel,
    className,
}: {
    conversations: T[];
    loading?: boolean;
    activeId: number | null;
    /**
     * The conversation holding an open assist session, if any.
     *
     * Only ever the active one — an assist session belongs to the conversation
     * it was opened from, and the store holds exactly one.
     */
    assistingId?: number | null;
    onNewChat: () => void;
    onOpen: (conversation: T) => void;
    /** Absent on surfaces whose conversations cannot be bookmarked. */
    onToggleSave?: (conversation: T) => void;
    onDelete: (conversation: T) => void;
    onClose?: () => void;
    newChatLabel: string;
    className?: string;
}) {
    const assisting = conversations.filter(c => c.id === assistingId);
    const saved = conversations.filter(c => c.id !== assistingId && c.is_saved);
    const recent = conversations.filter(c => c.id !== assistingId && !c.is_saved);

    const groups: { key: string; label: string; items: T[]; assist?: boolean }[] = [
        { key: 'assisting', label: m['server.ai.rail.assisting'](), items: assisting, assist: true },
        { key: 'saved', label: m['server.ai.rail.saved'](), items: saved },
        { key: 'recent', label: m['server.ai.rail.recent'](), items: recent },
    ];

    return (
        <div
            className={cn(
                'flex h-full w-56 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border-strong)] bg-[var(--color-surface)]',
                className,
            )}
        >
            <div className="flex shrink-0 gap-1 p-2.5">
                <button
                    type="button"
                    onClick={onNewChat}
                    className="flex w-full items-center gap-2 rounded-md border border-[var(--color-border-strong)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" />
                    {newChatLabel}
                </button>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        title={m['server.ai.hideHistory']()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] lg:hidden"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {loading && (
                    <div className="flex justify-center py-6">
                        <Spinner className="h-4 w-4" />
                    </div>
                )}

                {!loading && conversations.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-[var(--color-ink-faint)]">
                        {m['server.ai.historyEmpty']()}
                    </p>
                )}

                {groups.map(group =>
                    group.items.length === 0 ? null : (
                        <div key={group.key}>
                            <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                                {group.label}
                                <span className="ml-auto tabular-nums opacity-60">{group.items.length}</span>
                            </div>

                            {group.items.map(conversation => (
                                <div
                                    key={conversation.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onOpen(conversation)}
                                    onKeyDown={event => event.key === 'Enter' && onOpen(conversation)}
                                    className={cn(
                                        'group flex cursor-pointer flex-col border-l-2 px-3 py-1.5 transition-colors',
                                        conversation.id === activeId
                                            ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                                            : 'border-l-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                                        conversation.id === activeId &&
                                            (group.assist
                                                ? 'border-l-[var(--color-warning)]'
                                                : 'border-l-[var(--brand)]'),
                                    )}
                                >
                                    <div className="flex items-center gap-1.5">
                                        {group.assist && (
                                            <span
                                                aria-hidden
                                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]"
                                            />
                                        )}
                                        {!group.assist && conversation.is_saved && (
                                            <Bookmark className="h-3 w-3 shrink-0 fill-current text-[var(--brand-bright)]" />
                                        )}

                                        <span
                                            className={cn(
                                                'min-w-0 flex-1 truncate text-xs',
                                                conversation.id === activeId && 'font-medium',
                                            )}
                                        >
                                            {conversation.title}
                                        </span>

                                        {onToggleSave && (
                                            <button
                                                type="button"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    onToggleSave(conversation);
                                                }}
                                                title={
                                                    conversation.is_saved
                                                        ? m['server.ai.unsaveChat']()
                                                        : m['server.ai.saveChat']()
                                                }
                                                className={cn(
                                                    'shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] transition-opacity hover:text-[var(--brand-bright)]',
                                                    'opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
                                                    'lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100',
                                                )}
                                            >
                                                <Bookmark
                                                    className={cn(
                                                        'h-3 w-3',
                                                        conversation.is_saved && 'fill-current',
                                                    )}
                                                />
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={event => {
                                                event.stopPropagation();
                                                onDelete(conversation);
                                            }}
                                            title={m['common.actions.delete']()}
                                            className={cn(
                                                'shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] transition-opacity hover:text-[var(--color-danger)]',
                                                'opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
                                                'lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100',
                                            )}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </div>

                                    {!conversation.is_saved && conversation.expires_at && (
                                        <span className="mt-0.5 font-mono text-[9.5px] text-[var(--color-ink-faint)]">
                                            {m['server.ai.expires']({
                                                date: new Date(conversation.expires_at).toLocaleDateString(),
                                            })}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}
