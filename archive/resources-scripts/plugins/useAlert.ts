import { useAlerts } from '@/contexts/AlertContext';
import { httpErrorToHuman } from '@/api/http';

interface KeyedAlertStore {
    addError: (message: string, title?: string) => void;
    clearAlerts: () => void;
    clearAndAddHttpError: (error?: Error | string | null) => void;
}

/**
 * Hook to use the new Alert Manager with a specific key for scoped alerts.
 * This is useful for showing alerts that are specific to a page or component.
 */
const useAlertKey = (key: string): KeyedAlertStore => {
    const { addAlert, clearAlerts } = useAlerts();

    return {
        addError: (message, title) =>
            addAlert({
                key,
                message,
                title: title || 'Error',
                type: 'error',
            }),
        clearAlerts: () => clearAlerts(key),
        clearAndAddHttpError: error => {
            clearAlerts(key);
            if (error) {
                const message = httpErrorToHuman(error);
                addAlert({
                    key,
                    type: 'error',
                    title: 'Error',
                    message,
                });
            }
        },
    };
};

export { useAlertKey };
// Re-export useAlerts as default for convenience
export { useAlerts as default };
