import { describe, expect, it } from 'vitest';
import { dismissAlertForUser, getAlertDismissKey, isAlertDismissedForUser } from './alerts';

describe('alert dismissal helpers', () => {
    const userId = 'user-1';

    it('ignores dismissal flags for non-dismissible alerts', () => {
        const key = getAlertDismissKey(1, userId);
        localStorage.setItem(key, 'true');

        expect(isAlertDismissedForUser({ id: 1, dismissible: false }, userId)).toBe(false);
    });

    it('marks and detects dismissal when allowed', () => {
        const alert = { id: 2, dismissible: true };

        dismissAlertForUser(alert, userId);

        expect(isAlertDismissedForUser(alert, userId)).toBe(true);
    });

    it('does not persist dismissal for non-dismissible alerts', () => {
        const alert = { id: 3, dismissible: false };
        const key = getAlertDismissKey(alert.id, userId);

        dismissAlertForUser(alert, userId);

        expect(localStorage.getItem(key)).toBeNull();
    });
});
