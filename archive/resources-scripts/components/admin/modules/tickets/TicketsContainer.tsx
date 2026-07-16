import tw from 'twin.macro';
import { Link, NavLink } from 'react-router-dom';
import { useContext, useEffect } from 'react';
import AdminTable, {
    ContentWrapper,
    Loading,
    NoItems,
    Pagination,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
    useTableHooks,
} from '@/elements/AdminTable';
import { Button } from '@/elements/button';
import CopyOnClick from '@/elements/CopyOnClick';
import { differenceInHours, format, formatDistanceToNow } from 'date-fns';
import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';
import Avatar from '@/elements/Avatar';
import { getTickets, Context as TicketsContext } from '@/api/routes/admin/tickets';
import { TicketFilters } from '@/api/routes/admin/tickets/types';
import { statusToColor, priorityToColor, priorityDotColor } from '@/utils/ticketStatus';
import type { TicketStatusType, TicketPriorityType } from '@/utils/ticketStatus';

function TicketContainer() {
    const { data: tickets } = getTickets();
    const { colors } = useStoreState(state => state.theme.data!);
    const { setPage, setFilters, sort, setSort, sortDirection } = useContext(TicketsContext);

    const onSearch = (query: string): Promise<void> => {
        return new Promise(resolve => {
            if (query.length < 2) {
                setFilters(null);
            } else {
                setFilters({ title: query });
            }
            return resolve();
        });
    };

    useEffect(() => {
        document.title = 'Admin | Tickets';
    }, []);

    return (
        <>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Tickets</h2>
                    <p className={'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'}>
                        Update settings and manage user tickets.
                    </p>
                </div>
                <div css={tw`flex ml-auto pl-4`}>
                    <Link to={'/admin/tickets/new'}>
                        <Button>New Ticket</Button>
                    </Link>
                </div>
            </div>
            <AdminTable>
                <ContentWrapper onSearch={onSearch}>
                    <Pagination data={tickets} onPageSelect={setPage}>
                        <div css={tw`overflow-x-auto`}>
                            <table css={tw`w-full table-auto`}>
                                <TableHead>
                                    <TableHeader
                                        name={'ID'}
                                        direction={sort === 'id' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('id')}
                                    />
                                    <TableHeader
                                        name={'Title'}
                                        direction={sort === 'title' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('title')}
                                    />
                                    <TableHeader
                                        name={'Status'}
                                        direction={sort === 'status' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('status')}
                                    />
                                    <TableHeader
                                        name={'Priority'}
                                        direction={sort === 'priority' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('priority')}
                                    />
                                    <TableHeader name={'Assigned To'} />
                                    <TableHeader
                                        name={'Last Reply'}
                                        direction={sort === 'last_reply_at' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('last_reply_at')}
                                    />
                                </TableHead>
                                <TableBody>
                                    {tickets !== undefined &&
                                        tickets.items.length > 0 &&
                                        tickets.items.map(ticket => {
                                            const lastActivity = ticket.last_reply_at ?? ticket.created_at;
                                            const timeLabel =
                                                Math.abs(differenceInHours(lastActivity, new Date())) > 48
                                                    ? format(lastActivity, 'MMM do, yyyy h:mma')
                                                    : formatDistanceToNow(lastActivity, { addSuffix: true });

                                            return (
                                                <TableRow key={ticket.id}>
                                                    <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                        <CopyOnClick text={ticket.id}>
                                                            <code css={tw`font-mono bg-neutral-900 rounded py-1 px-2`}>
                                                                {ticket.id}
                                                            </code>
                                                        </CopyOnClick>
                                                    </td>
                                                    <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                        <NavLink
                                                            to={`/admin/tickets/${ticket.id}`}
                                                            style={{ color: colors.primary }}
                                                            className={'duration-300 hover:brightness-125'}
                                                        >
                                                            {ticket.title}
                                                        </NavLink>
                                                    </td>
                                                    <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                        <span
                                                            className={classNames(
                                                                statusToColor(ticket.status as TicketStatusType),
                                                                'inline-flex rounded-full px-2 text-xs font-medium capitalize leading-5',
                                                            )}
                                                        >
                                                            {ticket.status}
                                                        </span>
                                                    </td>
                                                    <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                        <span
                                                            className={classNames(
                                                                priorityToColor((ticket.priority ?? 'medium') as TicketPriorityType),
                                                                'inline-flex items-center gap-1 rounded-full px-2 text-xs font-medium capitalize leading-5',
                                                            )}
                                                        >
                                                            <span
                                                                className={classNames(
                                                                    priorityDotColor((ticket.priority ?? 'medium') as TicketPriorityType),
                                                                    'h-1.5 w-1.5 rounded-full',
                                                                )}
                                                            />
                                                            {ticket.priority ?? 'medium'}
                                                        </span>
                                                    </td>
                                                    <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                        <div className={'my-2 inline-flex items-center'}>
                                                            <Avatar size={24} name={ticket.assigned_to?.email ?? 'null'} />
                                                            <div className={'ml-2'}>
                                                                {ticket.assigned_to?.email ?? 'Unassigned'}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}>
                                                        {timeLabel}
                                                    </td>
                                                </TableRow>
                                            );
                                        })}
                                </TableBody>
                            </table>

                            {tickets === undefined ? <Loading /> : tickets.items.length < 1 ? <NoItems /> : null}
                        </div>
                    </Pagination>
                </ContentWrapper>
            </AdminTable>
        </>
    );
}

export default () => {
    const hooks = useTableHooks<TicketFilters>();

    return (
        <TicketsContext.Provider value={hooks}>
            <TicketContainer />
        </TicketsContext.Provider>
    );
};
