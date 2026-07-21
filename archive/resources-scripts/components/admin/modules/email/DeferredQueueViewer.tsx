import { useEffect, useState } from 'react';
import {
    getDeferredQueue,
    sendDeferredNow,
    cancelDeferred,
    type DeferredQueueResponse,
} from '@/api/routes/admin/email';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import tw from 'twin.macro';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRedo, faTimes, faClock, faCheckCircle } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';

const Table = styled.table`
    ${tw`w-full table-auto`}
`;

const Th = styled.th`
    ${tw`px-4 py-3 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider border-b border-neutral-700`}
`;

const Td = styled.td`
    ${tw`px-4 py-3 text-sm border-b border-neutral-700`}
`;

const StatCard = styled.div<{ $background: string }>`
    ${tw`rounded-lg p-4 border border-neutral-700`}
    background-color: ${({ $background }) => $background};
`;

export default () => {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [data, setData] = useState<DeferredQueueResponse | null>(null);
    const [actionInProgress, setActionInProgress] = useState<Record<number, string>>({});
    const { addFlash } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);

    useEffect(() => {
        loadQueue();
        // Auto-refresh every 30 seconds
        const interval = setInterval(() => {
            loadQueue(true);
        }, 30000);

        return () => clearInterval(interval);
    }, []);

    const loadQueue = async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);

        try {
            const response = await getDeferredQueue();
            setData(response);
        } catch (error: any) {
            addFlash({
                key: 'email:deferred',
                type: 'error',
                message: error.message || 'Failed to load deferred email queue',
            });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleSendNow = async (id: number) => {
        setActionInProgress({ ...actionInProgress, [id]: 'sending' });
        try {
            await sendDeferredNow(id);
            addFlash({
                key: 'email:deferred',
                type: 'success',
                message: 'Email moved to front of queue and will be sent shortly.',
            });
            await loadQueue(true);
        } catch (error: any) {
            addFlash({
                key: 'email:deferred',
                type: 'error',
                message: error.message || 'Failed to send email',
            });
        } finally {
            const newActions = { ...actionInProgress };
            delete newActions[id];
            setActionInProgress(newActions);
        }
    };

    const handleCancel = async (id: number) => {
        setActionInProgress({ ...actionInProgress, [id]: 'canceling' });
        try {
            await cancelDeferred(id);
            addFlash({
                key: 'email:deferred',
                type: 'success',
                message: 'Deferred email cancelled',
            });
            await loadQueue(true);
        } catch (error: any) {
            addFlash({
                key: 'email:deferred',
                type: 'error',
                message: error.message || 'Failed to cancel email',
            });
        } finally {
            const newActions = { ...actionInProgress };
            delete newActions[id];
            setActionInProgress(newActions);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    const isDue = (scheduledAt: string) => {
        return new Date(scheduledAt) <= new Date();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner size="large" />
            </div>
        );
    }

    if (!data) {
        return (
            <div
                className="bg-neutral-800 rounded-lg border border-neutral-700 py-12 text-center"
                style={{ backgroundColor: colors.secondary, borderColor: colors.headers }}
            >
                <p className="text-neutral-400 text-lg">Failed to load deferred email queue</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Deferred Email Queue</h2>
                <Button onClick={() => loadQueue()} disabled={refreshing} variant="secondary" size="sm">
                    <FontAwesomeIcon icon={faRedo} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <StatCard $background={colors.secondary}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-neutral-400">Total Queued</p>
                            <p className="text-2xl font-bold text-white mt-1">{data.stats.total_queued}</p>
                        </div>
                        <FontAwesomeIcon icon={faClock} className="text-neutral-600 text-3xl" />
                    </div>
                </StatCard>

                <StatCard $background={colors.secondary}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-neutral-400">Due Now</p>
                            <p className="text-2xl font-bold text-yellow-400 mt-1">{data.stats.due_now}</p>
                        </div>
                        <FontAwesomeIcon icon={faCheckCircle} className="text-yellow-600 text-3xl" />
                    </div>
                </StatCard>

                <StatCard $background={colors.secondary}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-neutral-400">Next Send</p>
                            <p className="text-sm font-medium text-white mt-1">
                                {data.stats.next_send_time
                                    ? new Date(data.stats.next_send_time).toLocaleString()
                                    : 'N/A'}
                            </p>
                        </div>
                        <FontAwesomeIcon icon={faClock} className="text-neutral-600 text-3xl" />
                    </div>
                </StatCard>
            </div>

            {/* Queue Table */}
            {data.deferred.data.length > 0 ? (
                <div
                    className="bg-neutral-800 rounded-lg border border-neutral-700 overflow-hidden"
                    style={{ backgroundColor: colors.secondary, borderColor: colors.headers }}
                >
                    <div className="overflow-x-auto">
                        <Table>
                            <thead>
                                <tr>
                                    <Th>Recipient</Th>
                                    <Th>Template</Th>
                                    <Th>Reason</Th>
                                    <Th>Scheduled</Th>
                                    <Th>Attempts</Th>
                                    <Th>Actions</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.deferred.data.map(email => (
                                    <tr key={email.id} className="hover:bg-neutral-800 transition-colors">
                                        <Td>
                                            <div className="flex items-center">
                                                <span className="text-neutral-300">{email.recipient}</span>
                                                {email.user && (
                                                    <span className="ml-2 text-xs text-gray-500">
                                                        ({email.user.username})
                                                    </span>
                                                )}
                                            </div>
                                        </Td>
                                        <Td>
                                            <code className="text-xs bg-neutral-900 px-2 py-1 rounded text-neutral-300">
                                                {email.template_key}
                                            </code>
                                        </Td>
                                        <Td>
                                            <span className="text-xs px-2 py-1 rounded bg-yellow-900 text-yellow-300">
                                                {email.reason.replace(/_/g, ' ')}
                                            </span>
                                        </Td>
                                        <Td>
                                            <div className="flex items-center">
                                                <span
                                                    className={`text-sm ${
                                                        isDue(email.scheduled_at)
                                                            ? 'text-yellow-400'
                                                            : 'text-neutral-400'
                                                    }`}
                                                >
                                                    {formatDate(email.scheduled_at)}
                                                </span>
                                                {isDue(email.scheduled_at) && (
                                                    <span className="ml-2 text-xs px-2 py-1 rounded bg-yellow-900 text-yellow-300">
                                                        DUE
                                                    </span>
                                                )}
                                            </div>
                                        </Td>
                                        <Td>
                                            <span
                                                className={email.attempts > 1 ? 'text-yellow-400' : 'text-neutral-400'}
                                            >
                                                {email.attempts}
                                            </span>
                                        </Td>
                                        <Td>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => handleSendNow(email.id)}
                                                    disabled={!!actionInProgress[email.id]}
                                                    variant="primary"
                                                    size="sm"
                                                >
                                                    {actionInProgress[email.id] === 'sending' ? (
                                                        <Spinner size="small" />
                                                    ) : (
                                                        <>
                                                            <FontAwesomeIcon icon={faCheckCircle} className="mr-1" />
                                                            Move to Front
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    onClick={() => handleCancel(email.id)}
                                                    disabled={!!actionInProgress[email.id]}
                                                    variant="secondary"
                                                    size="sm"
                                                >
                                                    {actionInProgress[email.id] === 'canceling' ? (
                                                        <Spinner size="small" />
                                                    ) : (
                                                        <>
                                                            <FontAwesomeIcon icon={faTimes} className="mr-1" />
                                                            Cancel
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </div>
                </div>
            ) : (
                <div
                    className="bg-neutral-800 rounded-lg border border-neutral-700 py-12 text-center"
                    style={{ backgroundColor: colors.secondary, borderColor: colors.headers }}
                >
                    <p className="text-neutral-400 text-lg">No deferred emails in queue</p>
                    <p className="text-gray-500 text-sm mt-2">All emails are being delivered normally</p>
                </div>
            )}
        </div>
    );
};
