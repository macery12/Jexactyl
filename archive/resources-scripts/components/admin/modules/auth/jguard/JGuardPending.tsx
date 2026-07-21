import { useEffect, useState } from 'react';
import { formatDistanceToNow, isPast, parseISO } from 'date-fns';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import { faCheck, faTimes, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dialog } from '@/elements/dialog';
import FlashMessageRender from '@/elements/FlashMessageRender';
import {
    getJGuardPending,
    approveJGuardUser,
    rejectJGuardUser,
    type JGuardPendingUser,
} from '@/api/routes/admin/auth/jguard';

const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const TimeRemaining = ({ expiresAt }: { expiresAt: string | null }) => {
    if (!expiresAt) {
        return <span className={'text-neutral-500 italic'}>Awaiting manual approval</span>;
    }

    const date = parseISO(expiresAt);
    if (isPast(date)) {
        return <span className={'text-green-400'}>Activating shortly…</span>;
    }

    return <span className={'text-yellow-400'}>{formatDistanceToNow(date, { addSuffix: true })}</span>;
};

export default () => {
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const [loading, setLoading] = useState(true);
    const [entries, setEntries] = useState<JGuardPendingUser[]>([]);
    const [confirm, setConfirm] = useState<{ userId: number; action: 'approve' | 'reject' } | null>(null);
    const [busy, setBusy] = useState<number | null>(null);
    // Tick every 30s to refresh relative time strings.
    const [, setTick] = useState(0);

    const load = () => {
        setLoading(true);
        getJGuardPending('pending')
            .then(setEntries)
            .catch(error => clearAndAddHttpError({ key: 'auth:jguard:pending', error }))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();

        const interval = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(interval);
    }, []);

    const doAction = () => {
        if (!confirm) return;
        const { userId, action } = confirm;

        clearFlashes('auth:jguard:pending');
        setBusy(userId);
        setConfirm(null);

        const fn = action === 'approve' ? approveJGuardUser : rejectJGuardUser;
        fn(userId)
            .then(() => {
                setEntries(prev => prev.filter(e => e.user_id !== userId));
                addFlash({
                    key: 'auth:jguard:pending',
                    type: 'success',
                    message: action === 'approve' ? 'Account approved successfully.' : 'Account rejected successfully.',
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'auth:jguard:pending', error }))
            .finally(() => setBusy(null));
    };

    return (
        <div>
            <FlashMessageRender byKey={'auth:jguard:pending'} className={'mb-4'} />

            <Dialog.Confirm
                open={confirm !== null}
                title={confirm?.action === 'approve' ? 'Approve Account' : 'Reject Account'}
                onConfirmed={doAction}
                onClose={() => setConfirm(null)}
                confirm={confirm?.action === 'approve' ? 'Approve' : 'Reject'}
            >
                {confirm?.action === 'approve'
                    ? 'This user will be granted full access to the panel.'
                    : 'This user will be rejected and their account will be suspended.'}
            </Dialog.Confirm>

            <div className={'flex items-center justify-between mb-4'}>
                <p className={'text-sm text-neutral-400'}>
                    {loading ? 'Loading…' : `${entries.length} pending account${entries.length !== 1 ? 's' : ''}`}
                </p>
                <button
                    className={'text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1'}
                    onClick={load}
                    disabled={loading}
                >
                    <FontAwesomeIcon icon={faSync} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <Spinner centered size={'large'} />
            ) : entries.length === 0 ? (
                <p className={'text-sm text-neutral-400 text-center py-8'}>No pending accounts.</p>
            ) : (
                <div className={'overflow-x-auto'}>
                    <table className={'w-full text-sm'}>
                        <thead>
                            <tr
                                className={
                                    'text-left text-xs text-neutral-400 uppercase tracking-wider border-b border-neutral-700'
                                }
                            >
                                <th className={'px-4 py-3'}>Username</th>
                                <th className={'px-4 py-3'}>Email</th>
                                <th className={'px-4 py-3'}>Mode</th>
                                <th className={'px-4 py-3'}>Registered</th>
                                <th className={'px-4 py-3'}>Time Remaining</th>
                                <th className={'px-4 py-3 text-right'}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map(entry => (
                                <tr key={entry.id} className={'border-b border-neutral-700 hover:bg-neutral-800/30'}>
                                    <td className={'px-4 py-3 font-medium'}>{entry.username}</td>
                                    <td className={'px-4 py-3 text-neutral-300'}>{entry.email}</td>
                                    <td className={'px-4 py-3'}>
                                        <span className={'capitalize text-neutral-400'}>{entry.approval_mode}</span>
                                    </td>
                                    <td className={'px-4 py-3 text-neutral-400 text-xs'}>
                                        {formatDate(entry.created_at)}
                                    </td>
                                    <td className={'px-4 py-3 text-xs'}>
                                        <TimeRemaining expiresAt={entry.expires_at} />
                                    </td>
                                    <td className={'px-4 py-3'}>
                                        <div className={'flex items-center justify-end gap-2'}>
                                            <Button
                                                size={Button.Sizes.Small}
                                                disabled={busy === entry.user_id}
                                                onClick={() => setConfirm({ userId: entry.user_id, action: 'approve' })}
                                            >
                                                <FontAwesomeIcon icon={faCheck} className={'mr-1'} />
                                                Approve
                                            </Button>
                                            <Button.Warn
                                                size={Button.Sizes.Small}
                                                disabled={busy === entry.user_id}
                                                onClick={() => setConfirm({ userId: entry.user_id, action: 'reject' })}
                                            >
                                                <FontAwesomeIcon icon={faTimes} className={'mr-1'} />
                                                Reject
                                            </Button.Warn>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
