import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNow, differenceInHours } from 'date-fns';
import classNames from 'classnames';
import { Alert } from '@/elements/alert';
import Avatar from '@/elements/Avatar';
import { Button } from '@/elements/button';
import { Context as MessagesContext, getTicketMessages, createMessage } from '@/api/routes/admin/tickets/messages';
import { useTableHooks } from '@/elements/AdminTable';
import { TicketMessageFilters } from '@/api/routes/admin/tickets/types';
import useFlash from '@/plugins/useFlash';

interface Props {
    ticketId: number;
    ticketUserId: number;
    onMessageSent?: () => void;
}

const Thread = ({ ticketId, ticketUserId, onMessageSent }: Props) => {
    const { data: messages, error, mutate } = getTicketMessages(ticketId);
    const bottomRef = useRef<HTMLDivElement>(null);
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const [replyText, setReplyText] = useState('');
    const [isInternalNote, setIsInternalNote] = useState(false);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages?.items.length]);

    if (error) return <Alert type={'danger'}>Unable to load messages: {String(error)}</Alert>;

    const handleSend = async () => {
        if (!replyText.trim() || sending) return;
        const trimmed = replyText.trim();
        setSending(true);
        clearFlashes();

        try {
            await createMessage({ ticket_id: ticketId, message: trimmed, internal_note: isInternalNote });
            setReplyText('');
            await mutate();
            onMessageSent?.();
        } catch (err) {
            clearAndAddHttpError({ error: err as any });
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSend();
        }
    };

    const items = messages ? [...messages.items].reverse() : [];

    return (
        <div className={'flex h-full flex-col'}>

            {/* Messages — scrollable, fills remaining height */}
            <div
                className={'flex-1 overflow-y-auto rounded-xl p-4'}
                style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            >
                {!messages ? (
                    <p className={'m-auto text-sm text-gray-500'}>Loading messages…</p>
                ) : items.length === 0 ? (
                    <p className={'flex h-full items-center justify-center text-sm text-gray-500'}>No messages yet.</p>
                ) : (
                    items.map(msg => {
                        const isUserMessage = msg.author?.id === ticketUserId;
                        const isInternal = msg.internal_note;

                        const timestamp =
                            Math.abs(differenceInHours(msg.created_at, new Date())) > 48
                                ? format(msg.created_at, 'MMM do, yyyy h:mma')
                                : formatDistanceToNow(msg.created_at, { addSuffix: true });

                        return (
                            <div
                                key={msg.id}
                                className={classNames(
                                    'mb-4 flex',
                                    isUserMessage ? 'justify-start' : 'justify-end',
                                )}
                            >
                                {/* Avatar left side for user messages */}
                                {isUserMessage && (
                                    <Avatar
                                        size={28}
                                        name={msg.author?.email ?? 'unknown'}
                                        className={'mr-2 mt-1 shrink-0'}
                                    />
                                )}

                                {/* Bubble */}
                                <div
                                    className={classNames(
                                        'max-w-[75%] rounded-2xl px-4 py-3',
                                        isUserMessage
                                            ? 'rounded-tl-sm bg-neutral-700/70'
                                            : isInternal
                                                ? 'rounded-tr-sm border border-yellow-700/40 bg-yellow-900/20'
                                                : 'rounded-tr-sm bg-blue-700/40',
                                    )}
                                >
                                    <div className={'mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1'}>
                                        {msg.author ? (
                                            <Link
                                                to={`/admin/users/${msg.author.id}`}
                                                className={'text-xs font-medium text-neutral-300 hover:text-white'}
                                            >
                                                {msg.author.email}
                                            </Link>
                                        ) : (
                                            <span className={'text-xs text-gray-400'}>Unknown user</span>
                                        )}
                                        {isInternal && (
                                            <span className={'rounded bg-yellow-700/50 px-1.5 py-0.5 text-2xs font-medium text-yellow-300'}>
                                                Internal Note
                                            </span>
                                        )}
                                        <span className={'ml-auto shrink-0 text-xs text-gray-500'}>{timestamp}</span>
                                    </div>
                                    <p className={'whitespace-pre-wrap text-sm leading-relaxed text-neutral-200'}>
                                        {msg.message}
                                    </p>
                                </div>

                                {/* Avatar right side for admin messages */}
                                {!isUserMessage && (
                                    <Avatar
                                        size={28}
                                        name={msg.author?.email ?? 'unknown'}
                                        className={'ml-2 mt-1 shrink-0'}
                                    />
                                )}
                            </div>
                        );
                    })
                )}
                <div ref={bottomRef} />
            </div>

            {/* Composer — sticky at bottom */}
            <div className={'mt-3 shrink-0'}>
                <div className={'mb-2 flex gap-2'}>
                    <button
                        type={'button'}
                        onClick={() => setIsInternalNote(false)}
                        className={classNames(
                            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                            !isInternalNote
                                ? 'bg-neutral-600 text-white'
                                : 'text-gray-400 hover:text-gray-200',
                        )}
                    >
                        Reply to User
                    </button>
                    <button
                        type={'button'}
                        onClick={() => setIsInternalNote(true)}
                        className={classNames(
                            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                            isInternalNote
                                ? 'bg-yellow-700 text-yellow-100'
                                : 'text-gray-400 hover:text-gray-200',
                        )}
                    >
                        Internal Note
                    </button>
                </div>
                <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={4}
                    placeholder={
                        isInternalNote
                            ? 'Add an internal note (not visible to user)… Ctrl+Enter to send'
                            : 'Type a reply… Ctrl+Enter to send'
                    }
                    disabled={sending}
                    className={classNames(
                        'w-full resize-none rounded-xl border px-4 py-3 text-sm text-neutral-200 placeholder-gray-500 focus:outline-none focus:ring-1 disabled:opacity-50',
                        isInternalNote
                            ? 'border-yellow-700/50 bg-yellow-900/10 focus:ring-yellow-700'
                            : 'border-neutral-700 bg-neutral-800 focus:ring-neutral-500',
                    )}
                />
                <div className={'mt-2 flex justify-end'}>
                    <Button
                        type={'button'}
                        onClick={handleSend}
                        disabled={!replyText.trim() || sending}
                    >
                        {sending ? 'Sending…' : isInternalNote ? 'Save Note' : 'Send Reply'}
                    </Button>
                </div>
            </div>

        </div>
    );
};

export default ({ ticketId, ticketUserId, onMessageSent }: Props) => {
    const hooks = useTableHooks<TicketMessageFilters>();

    return (
        <MessagesContext.Provider value={hooks}>
            <Thread ticketId={ticketId} ticketUserId={ticketUserId} onMessageSent={onMessageSent} />
        </MessagesContext.Provider>
    );
};
