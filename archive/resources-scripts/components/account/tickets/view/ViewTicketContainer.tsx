import { useEffect, useRef, useState } from 'react';
import { useFlashKey } from '@/plugins/useFlash';
import { useTicketFromRoute, createMessage } from '@/api/routes/account/tickets';
import PageContentBlock from '@/elements/PageContentBlock';
import Spinner from '@/elements/Spinner';
import classNames from 'classnames';
import { format } from 'date-fns';
import { useStoreState } from '@/state/hooks';
import { Link } from 'react-router-dom';
import MessageBubble from '@account/tickets/MessageBubble';
import DeleteTicketDialog from './DeleteTicketDialog';
import { statusToColor, priorityToColor, priorityDotColor } from '@/utils/ticketStatus';
import type { TicketStatusType, TicketPriorityType } from '@/utils/ticketStatus';

export default () => {
    const { email } = useStoreState(state => state.user.data!);
    const { colors } = useStoreState(state => state.theme.data!);
    const { data: ticket, error, isLoading, mutate } = useTicketFromRoute();
    const { clearAndAddHttpError } = useFlashKey('account:tickets');
    const bottomRef = useRef<HTMLDivElement>(null);

    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        clearAndAddHttpError(error);
    }, [error]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [ticket?.relationships.messages?.length]);

    const handleSend = async () => {
        if (!ticket || !message.trim() || sending) return;
        const trimmed = message.trim();
        setSending(true);

        try {
            await createMessage(ticket.id, trimmed);
            setMessage('');
            await mutate();
        } catch (err) {
            clearAndAddHttpError(err as any);
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

    return (
        <PageContentBlock title={'View Ticket'}>
            {isLoading || !ticket ? (
                <Spinner size={'large'} centered />
            ) : (
                <>
                    <div className={'mb-6 flex items-center gap-3'}>
                        <Link to={'/account/tickets'} className={'text-sm text-gray-400 hover:text-gray-200'}>
                            ← Tickets
                        </Link>
                        <span className={'text-gray-600'}>/</span>
                        <h1 className={'truncate text-lg font-semibold text-neutral-100'}>{ticket.title}</h1>
                        <span
                            className={classNames(
                                statusToColor(ticket.status as TicketStatusType),
                                'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                            )}
                        >
                            {ticket.status}
                        </span>
                        {ticket.priority !== 'medium' && (
                            <span
                                className={classNames(
                                    priorityToColor(ticket.priority as TicketPriorityType),
                                    'hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize sm:inline-flex',
                                )}
                            >
                                <span
                                    className={classNames(
                                        priorityDotColor(ticket.priority as TicketPriorityType),
                                        'h-1.5 w-1.5 rounded-full',
                                    )}
                                />
                                {ticket.priority}
                            </span>
                        )}
                    </div>

                    <div className={'grid gap-6 lg:grid-cols-3'}>
                        <div className={'flex flex-col lg:col-span-2'}>
                            <div
                                className={'flex flex-1 flex-col rounded-xl p-4'}
                                style={{ minHeight: '400px', backgroundColor: 'rgba(255,255,255,0.03)' }}
                            >
                                {!ticket.relationships.messages || ticket.relationships.messages.length === 0 ? (
                                    <p className={'m-auto text-sm text-gray-500'}>No messages yet.</p>
                                ) : (
                                    <div className={'flex flex-col'}>
                                        {[...ticket.relationships.messages].reverse().map(msg => (
                                            <MessageBubble
                                                key={msg.id}
                                                message={msg}
                                                isOwn={msg.author?.email === email}
                                            />
                                        ))}
                                        <div ref={bottomRef} />
                                    </div>
                                )}
                            </div>

                            <div className={'mt-4'}>
                                <textarea
                                    value={message}
                                    onChange={e => setMessage(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    rows={4}
                                    placeholder={'Type your message… (Ctrl+Enter to send)'}
                                    disabled={sending || ticket.status === 'resolved'}
                                    className={
                                        'w-full resize-none rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm text-neutral-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:opacity-50'
                                    }
                                />
                                <div className={'mt-2 flex justify-end'}>
                                    <button
                                        onClick={handleSend}
                                        disabled={!message.trim() || sending || ticket.status === 'resolved'}
                                        className={
                                            'rounded-lg px-5 py-2 text-sm font-medium text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
                                        }
                                        style={{ backgroundColor: colors.primary }}
                                    >
                                        {sending ? 'Sending…' : 'Send Message'}
                                    </button>
                                </div>
                                {ticket.status === 'resolved' && (
                                    <p className={'mt-2 text-center text-xs text-gray-500'}>
                                        This ticket is resolved and closed to new replies.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className={'space-y-4'}>
                            <div className={'rounded-xl p-5 shadow-lg'} style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                                <h3 className={'mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400'}>
                                    Ticket Info
                                </h3>
                                <dl className={'space-y-3 text-sm'}>
                                    <div className={'flex justify-between'}>
                                        <dt className={'text-gray-400'}>ID</dt>
                                        <dd className={'font-mono font-medium text-neutral-200'}>#{ticket.id}</dd>
                                    </div>
                                    <div className={'flex justify-between'}>
                                        <dt className={'text-gray-400'}>Status</dt>
                                        <dd>
                                            <span
                                                className={classNames(
                                                    statusToColor(ticket.status as TicketStatusType),
                                                    'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                                )}
                                            >
                                                {ticket.status}
                                            </span>
                                        </dd>
                                    </div>
                                    <div className={'flex justify-between'}>
                                        <dt className={'text-gray-400'}>Priority</dt>
                                        <dd>
                                            <span
                                                className={classNames(
                                                    priorityToColor(ticket.priority as TicketPriorityType),
                                                    'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                                )}
                                            >
                                                {ticket.priority}
                                            </span>
                                        </dd>
                                    </div>
                                    <div className={'flex justify-between'}>
                                        <dt className={'text-gray-400'}>Opened</dt>
                                        <dd className={'text-neutral-300'}>
                                            {format(ticket.createdAt, 'MMM do, yyyy')}
                                        </dd>
                                    </div>
                                    {ticket.lastReplyAt && (
                                        <div className={'flex justify-between'}>
                                            <dt className={'text-gray-400'}>Last reply</dt>
                                            <dd className={'text-neutral-300'}>
                                                {format(ticket.lastReplyAt, 'MMM do, yyyy')}
                                            </dd>
                                        </div>
                                    )}
                                    <div className={'flex justify-between'}>
                                        <dt className={'text-gray-400'}>Messages</dt>
                                        <dd className={'text-neutral-300'}>
                                            {ticket.relationships.messages?.length ?? 0}
                                        </dd>
                                    </div>
                                </dl>
                            </div>

                            <div className={'rounded-xl p-5'} style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                                <h3 className={'mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400'}>
                                    Actions
                                </h3>
                                <DeleteTicketDialog />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </PageContentBlock>
    );
};
