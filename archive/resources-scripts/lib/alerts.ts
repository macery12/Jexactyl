import { ActiveAlert } from '@/api/client/alerts';

export const getAlertDismissKey = (alertId: number, userId: string): string => `alert_dismissed_${alertId}_${userId}`;

export const isAlertDismissedForUser = (alert: Pick<ActiveAlert, 'id' | 'dismissible'>, userId: string): boolean => {
    if (!alert.dismissible) return false;

    return localStorage.getItem(getAlertDismissKey(alert.id, userId)) === 'true';
};

export const dismissAlertForUser = (alert: Pick<ActiveAlert, 'id' | 'dismissible'>, userId: string): void => {
    if (!alert.dismissible) return;

    localStorage.setItem(getAlertDismissKey(alert.id, userId), 'true');
};
