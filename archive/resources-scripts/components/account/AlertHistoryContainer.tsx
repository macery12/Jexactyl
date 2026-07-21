import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell } from '@fortawesome/free-solid-svg-icons';
import AlertHistoryModal from '@account/AlertHistoryModal';
import { getActiveAlerts } from '@/api/client/alerts';
import { useStoreState } from '@/state/hooks';
import { isAlertDismissedForUser } from '@/lib/alerts';

export default () => {
    const { uuid: user } = useStoreState(s => s.user.data!);
    const [visible, setVisible] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        getActiveAlerts('all')
            .then(alerts => {
                const unread = alerts.filter(a => !isAlertDismissedForUser(a, user)).length;
                setUnreadCount(unread);
            })
            .catch(() => setUnreadCount(0));
    }, [user]);

    return (
        <>
            <AlertHistoryModal open={visible} onClose={() => setVisible(false)} />

            <div className={'navigation-link'} onClick={() => setVisible(true)}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                    <FontAwesomeIcon icon={faBell} />
                    {unreadCount > 0 && (
                        <span
                            style={{
                                position: 'absolute',
                                top: '-8px',
                                right: '-10px',
                                backgroundColor: '#ef4444',
                                color: 'white',
                                borderRadius: '10px',
                                padding: '2px 6px',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                minWidth: '18px',
                                textAlign: 'center',
                            }}
                        >
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </div>
                Alerts
            </div>
        </>
    );
};
