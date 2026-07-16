import { differenceInHours, format, formatDistanceToNow } from 'date-fns';
import { statusToColor, priorityToColor, priorityDotColor } from '@/utils/ticketStatus';
import type { TicketStatusType, TicketPriorityType } from '@/utils/ticketStatus';
import classNames from 'classnames';
import AdminBox from '@/elements/AdminBox';
import { faCheckCircle, faGears, faXmarkCircle } from '@fortawesome/free-solid-svg-icons';
import UserSelect from '@admin/modules/tickets/UserSelect';
import { Form, Formik } from 'formik';
import type { FormikHelpers } from 'formik';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Select from '@/elements/Select';
import Label from '@/elements/Label';
import { useEffect, useState } from 'react';
import ConversationThread from '@admin/modules/tickets/view/ConversationThread';
import DeleteTicketDialog from './DeleteTicketDialog';
import { Alert } from '@/elements/alert';
import Spinner from '@/elements/Spinner';
import useStatus from '@/plugins/useStatus';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TicketStatus, TicketPriority, Values } from '@/api/routes/admin/tickets/types';
import { updateTicket, useTicketFromRoute } from '@/api/routes/admin/tickets';

export default () => {
    const { data: ticket, isLoading, mutate } = useTicketFromRoute();
    const boxStatus = useStatus();

    const [unassign, setUnassign] = useState<boolean>(false);
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const [status, setStatus] = useState<TicketStatus>('pending');
    const [priority, setPriority] = useState<TicketPriority>('medium');

    const submit = (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes();
        boxStatus.setStatus('loading');

        values.status = status;
        values.priority = priority;
        if (unassign) {
            values.assigned_to = null;
        }

        updateTicket(ticket!.id, values)
            .then(() => {
                setSubmitting(false);
                boxStatus.setStatus('success');
                mutate();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'tickets:view', error });
                boxStatus.setStatus('error');
            });
    };

    useEffect(() => {
        if (ticket) {
            document.title = `Admin | View ticket: ${ticket.title}`;
            setStatus(ticket.status);
            setPriority(ticket.priority ?? 'medium');
        }
    }, [ticket]);

    if (!ticket || isLoading) return <Spinner size={'large'} centered />;

    if (!ticket.user)
        return (
            <Alert type={'danger'}>
                This ticket was created without an assigned user. This ticket must be deleted.&nbsp;
                <DeleteTicketDialog ticketId={ticket.id} />
            </Alert>
        );

    return (
        <>
            {/* Header */}
            <div className={'mb-6 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'inline-flex flex-wrap items-center gap-2 font-header text-2xl font-medium'}>
                        {ticket.title}
                        <span
                            className={classNames(
                                statusToColor(ticket.status as TicketStatusType),
                                'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                            )}
                        >
                            {ticket.status}
                        </span>
                        <span
                            className={classNames(
                                priorityToColor((ticket.priority ?? 'medium') as TicketPriorityType),
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize',
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
                    </h2>
                    <p className={'mt-1 overflow-hidden overflow-ellipsis whitespace-nowrap text-sm text-neutral-400'}>
                        First created&nbsp;
                        {Math.abs(differenceInHours(ticket.created_at, new Date())) > 48
                            ? format(ticket.created_at, 'MMM do, yyyy h:mma')
                            : formatDistanceToNow(ticket.created_at, { addSuffix: true })}
                        {ticket.last_reply_at && (
                            <>
                                &nbsp;&middot; Last reply&nbsp;
                                {Math.abs(differenceInHours(ticket.last_reply_at, new Date())) > 48
                                    ? format(ticket.last_reply_at, 'MMM do, yyyy h:mma')
                                    : formatDistanceToNow(ticket.last_reply_at, { addSuffix: true })}
                            </>
                        )}
                    </p>
                </div>
            </div>

            <FlashMessageRender byKey={'tickets:view'} className={'mb-4'} />

            {/* Two-column body: chat (primary) + sidebar */}
            <div className={'flex flex-col gap-6 xl:flex-row xl:items-start'}>

                {/* Chat column */}
                <div
                    className={'flex min-w-0 flex-1 flex-col'}
                    style={{ height: 'calc(100vh - 280px)' }}
                >
                    <ConversationThread
                        ticketId={ticket.id}
                        ticketUserId={ticket.user.id}
                        onMessageSent={() => mutate()}
                    />
                </div>

                {/* Sidebar */}
                <div className={'w-full xl:w-80 xl:shrink-0'}>
                    <Formik
                        onSubmit={submit as any}
                        initialValues={{
                            title: ticket.title,
                            status: ticket.status,
                            priority: ticket.priority ?? 'medium',
                            user_id: ticket.user.id,
                        }}
                    >
                        {({ isSubmitting }) => (
                            <Form>
                                <AdminBox title={'Ticket Details'} icon={faGears} status={boxStatus.status}>
                                    <div className={'flex flex-col gap-4'}>
                                        <div>
                                            <Label>Status</Label>
                                            <Select
                                                defaultValue={ticket.status}
                                                onChange={e => setStatus(String(e.target.value) as TicketStatus)}
                                            >
                                                <option value={'pending'}>Pending</option>
                                                <option value={'in-progress'}>In Progress</option>
                                                <option value={'resolved'}>Resolved</option>
                                                <option value={'unresolved'}>Unresolved</option>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label>Priority</Label>
                                            <Select
                                                defaultValue={ticket.priority ?? 'medium'}
                                                onChange={e => setPriority(String(e.target.value) as TicketPriority)}
                                            >
                                                <option value={'low'}>Low</option>
                                                <option value={'medium'}>Medium</option>
                                                <option value={'high'}>High</option>
                                                <option value={'critical'}>Critical</option>
                                            </Select>
                                        </div>
                                        <div>
                                            <div className={classNames(ticket.assigned_to && 'grid grid-cols-8 gap-2')}>
                                                <div className={classNames(ticket.assigned_to && 'col-span-7')}>
                                                    <UserSelect isAdmin selected={ticket.assigned_to} />
                                                </div>
                                                {ticket.assigned_to && (
                                                    <div>
                                                        <FontAwesomeIcon
                                                            icon={unassign ? faCheckCircle : faXmarkCircle}
                                                            onClick={() => setUnassign(!unassign)}
                                                            className={'mt-10 w-5 cursor-pointer text-gray-400 hover:text-gray-200'}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <p className={'mt-1 text-xs text-gray-400'}>Assigned administrator</p>
                                        </div>
                                        <div>
                                            <UserSelect selected={ticket.user} />
                                            <p className={'mt-1 text-xs text-gray-400'}>Ticket owner</p>
                                        </div>
                                    </div>
                                    <div className={'mt-4 flex flex-col gap-2'}>
                                        <Button type={'submit'} disabled={isSubmitting} className={'w-full justify-center'}>
                                            Save Changes
                                        </Button>
                                        <DeleteTicketDialog ticketId={ticket.id} />
                                    </div>
                                </AdminBox>
                            </Form>
                        )}
                    </Formik>
                </div>

            </div>
        </>
    );
};
