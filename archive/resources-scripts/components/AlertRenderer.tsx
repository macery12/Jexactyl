import React from 'react';
import { useAlerts } from '@/contexts/AlertContext';
import AlertComponent from '@/components/AlertComponent';
import classNames from 'classnames';

interface AlertRendererProps {
    /**
     * Only show alerts with a specific key.
     * Useful for scoped alerts on specific pages or sections.
     */
    filterByKey?: string;
    /**
     * Custom className for the container
     */
    className?: string;
    /**
     * Position of the alert container
     * @default 'bottom-right'
     */
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
}

const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
};

export const AlertRenderer: React.FC<AlertRendererProps> = ({ filterByKey, className, position = 'bottom-right' }) => {
    const { alerts, dismissAlert } = useAlerts();

    // Filter alerts by key if specified
    const filteredAlerts = filterByKey
        ? alerts.filter(alert => alert.key === filterByKey)
        : alerts.filter(alert => !alert.key); // Show only global alerts if no key specified

    if (filteredAlerts.length === 0) {
        return null;
    }

    return (
        <div
            className={classNames('fixed z-50 flex flex-col gap-3', positionClasses[position], className)}
            style={{ maxWidth: 'min(90vw, 400px)' }}
        >
            {filteredAlerts.map(alert => (
                <AlertComponent key={alert.id} alert={alert} onDismiss={dismissAlert} />
            ))}
        </div>
    );
};

export default AlertRenderer;
