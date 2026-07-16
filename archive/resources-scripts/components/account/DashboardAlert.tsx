import { useState, useEffect } from 'react';
import { Alert } from '@/elements/alert';
import { useStoreState } from '@/state/hooks';
import { Dialog } from '@/elements/dialog';
import { ActiveAlert, getActiveAlerts } from '@/api/client/alerts';
import SlideOutAlert from '@/components/elements/SlideOutAlert';
import { capitalize } from '@/lib/strings';
import { dismissAlertForUser, isAlertDismissedForUser } from '@/lib/alerts';

export default () => {
    const { uuid: user } = useStoreState(s => s.user.data!);
    const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
    const [dialogAlertIndex, setDialogAlertIndex] = useState(0);

    // Load active alerts from the new system for dashboard scope
    useEffect(() => {
        getActiveAlerts('dashboard')
            .then(data => {
                setAlerts(data);
            })
            .catch(() => setAlerts([]));
    }, []);

    // Helper function to check if an alert is dismissed
    const isAlertDismissed = (alert: ActiveAlert): boolean => isAlertDismissedForUser(alert, user);

    // Helper function to dismiss an alert
    const dismissAlert = (alert: ActiveAlert) => dismissAlertForUser(alert, user);

    // Filter out dismissed alerts and notification-only alerts, then group by position
    const visibleAlerts = alerts.filter(a => !isAlertDismissed(a) && (a.position as string) !== 'notification');
    const topCenterAlerts = visibleAlerts.filter(a => a.position === 'top-center');
    const slideOutAlerts = visibleAlerts.filter(a => a.position === 'slide-out');
    const centerAlerts = visibleAlerts.filter(a => a.position === 'center');

    // Get the current center alert to show
    const currentCenterAlert = centerAlerts[dialogAlertIndex] || null;

    // Close popups only when dismissal is allowed
    const handleCenterAlertClose = () => {
        if (!currentCenterAlert?.dismissible) return;

        // Mark as dismissed for this user
        if (currentCenterAlert) {
            dismissAlert(currentCenterAlert);
        }

        // Move to next center alert if available
        if (dialogAlertIndex + 1 < centerAlerts.length) {
            setDialogAlertIndex(dialogAlertIndex + 1);
        } else {
            // Force re-render to hide the dialog
            setAlerts(prev => [...prev]);
        }
    };

    const handleSlideOutClose = (alert: ActiveAlert) => {
        dismissAlert(alert);
        // Force re-render to update visible alerts
        setAlerts(prev => [...prev]);
    };

    const handleTopCenterClose = (alert: ActiveAlert) => {
        dismissAlert(alert);
        // Force re-render to update visible alerts
        setAlerts(prev => [...prev]);
    };

    const renderAlertContent = (alert: ActiveAlert) => (
        <>
            {alert.title && <strong className={'mb-2 block text-base font-semibold'}>{alert.title}</strong>}
            <span className={'block'}>{alert.content}</span>
            {alert.link && (
                <a
                    href={alert.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={'mt-2 block underline hover:text-blue-300'}
                >
                    {alert.link_text || 'Learn more'}
                </a>
            )}
        </>
    );

    return (
        <>
            {/* Top Center alerts */}
            {topCenterAlerts.length > 0 && (
                <div className="mb-4 space-y-3">
                    {topCenterAlerts.map(alert => (
                        <Alert
                            key={alert.id}
                            type={alert.type}
                            onClose={alert.dismissible ? () => handleTopCenterClose(alert) : undefined}
                        >
                            {renderAlertContent(alert)}
                        </Alert>
                    ))}
                </div>
            )}

            {/* Slide-out Alerts - positioned to avoid header conflicts */}
            {slideOutAlerts.map((alert, index) => (
                <SlideOutAlert
                    key={alert.id}
                    id={alert.id}
                    title={alert.title}
                    content={alert.content}
                    type={alert.type}
                    link={alert.link}
                    link_text={alert.link_text}
                    dismissible={alert.dismissible}
                    onClose={alert.dismissible ? () => handleSlideOutClose(alert) : undefined}
                    index={index}
                />
            ))}

            {/* Center Dialog Alerts - Always allow dismissal to prevent page blocking */}
            {currentCenterAlert && (
                <Dialog.Confirm
                    open
                    buttonType={currentCenterAlert.type}
                    onClose={handleCenterAlertClose}
                    title={currentCenterAlert.title || capitalize(currentCenterAlert.type)}
                    onConfirmed={handleCenterAlertClose}
                >
                    {renderAlertContent(currentCenterAlert)}
                </Dialog.Confirm>
            )}
        </>
    );
};
