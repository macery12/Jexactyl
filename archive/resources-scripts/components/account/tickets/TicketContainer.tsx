import { useEffect, useMemo, useState } from 'react';
import { useFlashKey } from '@/plugins/useFlash';
import { useTickets } from '@/api/routes/account/tickets';
import PageContentBlock from '@/elements/PageContentBlock';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { format, formatDistanceToNow, differenceInHours } from 'date-fns';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { useStoreState } from '@/state/hooks';
import ScopedAlert from '@/components/account/ScopedAlert';
import CreateTicketForm from '@account/tickets/CreateTicketForm';
import { statusToColor, priorityToColor, priorityDotColor } from '@/utils/ticketStatus';
import type { TicketStatusType } from '@/utils/ticketStatus';

type FilterTab = 'all' | 'open' | 'resolved';

const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
];

export default () => {
    const { clearAndAddHttpError } = useFlashKey('account');
    const { colors } = useStoreState(state => state.theme.data!);
    const { data: tickets, isValidating, error } = useTickets({ revalidateOnMount: true, revalidateOnFocus: false });

    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [search, setSearch] = useState('');
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        clearAndAddHttpError(error);
    }, [error]);

    const filtered = useMemo(() => {
        if (!tickets) return [];

        return tickets.filter(ticket => {
            const matchesTab =
                activeTab === 'all' ||
                (activeTab === 'open' && (ticket.status === 'pending' || ticket.status === 'in-progress')) ||
                (activeTab === 'resolved' && ticket.status === 'resolved');

            const matchesSearch =
                !search || ticket.title.toLowerCase().includes(search.toLowerCase()) || String(ticket.id).includes(search);

            return matchesTab && matchesSearch;
        });
    }, [tickets, activeTab, search]);

    return (
        <PageContentBlock title={'Support Tickets'}>
            <ScopedAlert scope="account" position="top-center" />

            <div className={'mt-8 mb-6'}>
                <div className={'flex items-start justify-between gap-4'}>
                    <div>
                        <h1 className={'text-3xl font-bold lg:text-4xl'}>Support Center</h1>
                        <p className={'mt-1 text-sm text-gray-400'}>Get help from our support team.</p>
                    </div>
                    <button
                        onClick={() => setShowCreate(v => !v)}
                        className={classNames(
                            'mt-1 shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                            showCreate
                                ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                                : 'text-white hover:brightness-110',
                        )}
                        style={!showCreate ? { backgroundColor: colors.primary } : undefined}
                    >
                        {showCreate ? 'Cancel' : '+ New Ticket'}
                    </button>
                </div>
            </div>

            {showCreate && (
                <div
                    className={'mb-6 rounded-xl p-6 shadow-lg'}
                    style={{ backgroundColor: colors.secondary }}
                >
                    <h2 className={'mb-4 text-lg font-semibold text-neutral-200'}>Open a New Ticket</h2>
                    <CreateTicketForm />
                </div>
            )}

            <div className={'mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'}>
                <div className={'flex gap-1 rounded-lg bg-neutral-800 p-1'}>
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={classNames(
                                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                                activeTab === tab.key
                                    ? 'bg-neutral-600 text-white'
                                    : 'text-gray-400 hover:text-gray-200',
                            )}
                        >
                            {tab.label}
                            {tab.key !== 'all' && tickets && (
                                <span className={'ml-1.5 text-xs text-gray-500'}>
                                    {
                                        tickets.filter(t =>
                                            tab.key === 'open'
                                                ? t.status === 'pending' || t.status === 'in-progress'
                                                : t.status === 'resolved',
                                        ).length
                                    }
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <input
                    type="text"
                    placeholder="Search tickets…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className={
                        'w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 sm:w-56'
                    }
                />
            </div>

            <div className={'relative min-h-[4rem]'}>
                <SpinnerOverlay visible={!tickets && isValidating} />
                {!tickets || !tickets.length ? (
                    <p className={'mt-8 text-center text-sm text-gray-400'}>
                        {!tickets ? 'Loading…' : 'No tickets found for this account.'}
                    </p>
                ) : filtered.length === 0 ? (
                    <p className={'mt-8 text-center text-sm text-gray-400'}>No tickets match your filter.</p>
                ) : (
                    <div className={'flex flex-col gap-2'}>
                        {filtered.map(ticket => {
                            const lastActivity = ticket.lastReplyAt ?? ticket.createdAt;
                            const timeLabel =
                                Math.abs(differenceInHours(lastActivity, new Date())) > 48
                                    ? format(lastActivity, 'MMM do, yyyy')
                                    : formatDistanceToNow(lastActivity, { addSuffix: true });

                            return (
                                <Link key={ticket.id} to={`/account/tickets/${ticket.id}`}>
                                    <div
                                        className={
                                            'flex items-center gap-4 rounded-xl px-5 py-4 transition-all hover:brightness-110'
                                        }
                                        style={{ backgroundColor: colors.headers }}
                                    >
                                        <p className={'w-10 shrink-0 text-sm font-mono font-bold text-gray-500'}>
                                            #{ticket.id}
                                        </p>
                                        <div className={'min-w-0 flex-1'}>
                                            <p className={'truncate font-medium text-neutral-100'}>{ticket.title}</p>
                                            <p className={'mt-0.5 text-xs text-gray-500'}>
                                                {ticket.lastReplyAt ? 'Last reply' : 'Opened'} {timeLabel}
                                            </p>
                                        </div>
                                        <div className={'flex shrink-0 items-center gap-2'}>
                                            {ticket.priority !== 'medium' && (
                                                <span
                                                    className={classNames(
                                                        priorityToColor(ticket.priority),
                                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                                    )}
                                                >
                                                    <span
                                                        className={classNames(
                                                            priorityDotColor(ticket.priority),
                                                            'h-1.5 w-1.5 rounded-full',
                                                        )}
                                                    />
                                                    {ticket.priority}
                                                </span>
                                            )}
                                            <span
                                                className={classNames(
                                                    statusToColor(ticket.status as TicketStatusType),
                                                    'hidden rounded-full px-2 py-0.5 text-xs font-medium capitalize sm:inline',
                                                )}
                                            >
                                                {ticket.status}
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </PageContentBlock>
    );
};
