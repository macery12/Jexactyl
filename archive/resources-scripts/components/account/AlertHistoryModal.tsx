import { useEffect, useState } from 'react';
import { Dialog } from '@/elements/dialog';
import { ActiveAlert, getActiveAlerts } from '@/api/client/alerts';
import { capitalize } from '@/lib/strings';
import tw from 'twin.macro';
import Spinner from '@/elements/Spinner';
import { format } from 'date-fns';
import { useStoreState } from '@/state/hooks';
import { getAlertDismissKey, isAlertDismissedForUser } from '@/lib/alerts';

interface Props {
    open: boolean;
    onClose: () => void;
}

export default ({ open, onClose }: Props) => {
    const { uuid: user } = useStoreState(s => s.user.data!);
    const { colors } = useStoreState(s => s.theme.data!);
    const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        getActiveAlerts('all')
            .then(alerts => {
                alerts.sort((a, b) => b.priority - a.priority || b.id - a.id);
                setAlerts(alerts);
            })
            .catch(() => setAlerts([]))
            .finally(() => setLoading(false));
    }, [open]);

    // Check if an alert is dismissed
    const isAlertDismissed = (alert: ActiveAlert): boolean => isAlertDismissedForUser(alert, user);

    // Reopen a dismissed popup alert
    const reopenAlert = (alertId: number) => {
        const dismissedKey = getAlertDismissKey(alertId, user);
        localStorage.removeItem(dismissedKey);
        // Refresh the page to show the alert
        window.location.reload();
    };

    const getTypeBadge = (type: string) => {
        switch (type) {
            case 'success':
                return 'bg-green-500/30 text-green-300 border-green-400';
            case 'warning':
                return 'bg-yellow-500/30 text-yellow-300 border-yellow-400';
            case 'danger':
                return 'bg-red-500/30 text-red-300 border-red-400';
            default:
                return 'bg-blue-500/30 text-blue-300 border-blue-400';
        }
    };

    const getTypeBorderColor = (type: string) => {
        switch (type) {
            case 'success':
                return 'border-l-green-500';
            case 'warning':
                return 'border-l-yellow-500';
            case 'danger':
                return 'border-l-red-500';
            default:
                return 'border-l-blue-500';
        }
    };

    return (
        <Dialog open={open} onClose={onClose} title="Alert History">
            <div css={tw`space-y-4`}>
                {loading ? (
                    <div css={tw`flex justify-center py-8`}>
                        <Spinner size="large" />
                    </div>
                ) : alerts.length === 0 ? (
                    <div css={tw`text-center py-8 text-gray-400`}>
                        <p>No alerts found</p>
                        <p css={tw`text-sm mt-2`}>There are currently no active alerts in the system.</p>
                    </div>
                ) : (
                    <div css={tw`max-h-96 overflow-y-auto space-y-3`}>
                        {alerts.map(alert => {
                            const isDismissed = isAlertDismissed(alert);
                            const isPopup = alert.position === 'center';

                            return (
                                <div
                                    key={alert.id}
                                    className={`rounded-lg border border-l-8 border-gray-700 p-4 ${getTypeBorderColor(
                                        alert.type,
                                    )}`}
                                    style={{ backgroundColor: colors.secondary }}
                                >
                                    <div css={tw`flex items-start justify-between mb-2`}>
                                        <div css={tw`flex items-center gap-2 flex-wrap`}>
                                            {alert.title && (
                                                <h4 css={tw`font-semibold text-gray-200`}>{alert.title}</h4>
                                            )}
                                            <span
                                                className={`rounded border px-2 py-0.5 text-xs font-medium ${getTypeBadge(
                                                    alert.type,
                                                )}`}
                                            >
                                                {capitalize(alert.type)}
                                            </span>
                                            {isDismissed && (
                                                <span
                                                    css={tw`px-2 py-0.5 text-xs font-medium rounded border bg-gray-600/20 text-gray-400 border-gray-600`}
                                                >
                                                    Dismissed
                                                </span>
                                            )}
                                        </div>
                                        <span css={tw`text-xs text-gray-500 uppercase`}>{alert.scope}</span>
                                    </div>
                                    <p css={tw`text-gray-300 text-sm mb-2`}>{alert.content}</p>
                                    {alert.link && (
                                        <a
                                            href={alert.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            css={tw`text-blue-400 hover:text-blue-300 text-sm underline`}
                                        >
                                            {alert.link_text || 'Learn more'}
                                        </a>
                                    )}
                                    <div css={tw`flex items-center justify-between mt-3 pt-2 border-t border-gray-700`}>
                                        <div css={tw`text-xs text-gray-500`}>
                                            Position: <span css={tw`text-gray-400`}>{alert.position}</span>
                                        </div>
                                        {alert.start_at && (
                                            <div css={tw`text-xs text-gray-500`}>
                                                Active from:{' '}
                                                <span css={tw`text-gray-400`}>
                                                    {format(new Date(alert.start_at), 'MMM d, yyyy')}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    {/* Reopen button for dismissed alerts */}
                                    {isDismissed && (
                                        <div css={tw`mt-3 pt-2 border-t border-gray-700`}>
                                            <button
                                                type="button"
                                                onClick={() => reopenAlert(alert.id)}
                                                css={tw`px-3 py-1.5 text-sm text-white rounded transition-colors flex items-center gap-2`}
                                                style={{ backgroundColor: colors.primary }}
                                            >
                                                <svg
                                                    css={tw`w-4 h-4`}
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                    />
                                                </svg>
                                                {isPopup ? 'Reopen Popup' : 'Mark as Unread'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <Dialog.Footer>
                <button
                    type="button"
                    onClick={onClose}
                    css={tw`px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors`}
                >
                    Close
                </button>
            </Dialog.Footer>
        </Dialog>
    );
};
