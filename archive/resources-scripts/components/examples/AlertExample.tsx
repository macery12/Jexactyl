import React from 'react';
import { useAlerts } from '@/contexts/AlertContext';

/**
 * Example component demonstrating Alert Manager usage.
 * This can be used as a reference for implementing alerts in your components.
 */
export const AlertExample: React.FC = () => {
    const { success, error, info, warning, addAlert } = useAlerts();

    return (
        <div className="space-y-4 p-6">
            <h2 className="mb-4 text-2xl font-bold">Alert Manager Examples</h2>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Basic Alerts</h3>
                <button
                    onClick={() => success('Operation completed successfully!')}
                    className="mr-2 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                >
                    Show Success
                </button>
                <button
                    onClick={() => error('An error occurred. Please try again.')}
                    className="mr-2 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                >
                    Show Error
                </button>
                <button
                    onClick={() => info('Here is some useful information.')}
                    className="mr-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                    Show Info
                </button>
                <button
                    onClick={() => warning('Please be careful with this action.')}
                    className="rounded bg-yellow-600 px-4 py-2 text-white hover:bg-yellow-700"
                >
                    Show Warning
                </button>
            </div>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Alerts with Titles</h3>
                <button
                    onClick={() =>
                        error('Failed to save your changes. Please check your input and try again.', {
                            title: 'Save Error',
                        })
                    }
                    className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                >
                    Error with Title
                </button>
            </div>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Persistent Alerts</h3>
                <button
                    onClick={() =>
                        info('This alert will not auto-dismiss. You must close it manually.', {
                            timeout: false,
                        })
                    }
                    className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                    Persistent Alert
                </button>
            </div>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Alerts with Actions</h3>
                <button
                    onClick={() =>
                        addAlert({
                            type: 'warning',
                            message: 'Your session is about to expire. Would you like to extend it?',
                            title: 'Session Warning',
                            actions: [
                                {
                                    label: 'Extend Session',
                                    onClick: () => {
                                        success('Session extended successfully!');
                                    },
                                },
                                {
                                    label: 'Logout',
                                    onClick: () => {
                                        info('You have been logged out.');
                                    },
                                    variant: 'secondary',
                                },
                            ],
                            timeout: false,
                        })
                    }
                    className="rounded bg-yellow-600 px-4 py-2 text-white hover:bg-yellow-700"
                >
                    Alert with Actions
                </button>
            </div>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Non-dismissible Alert</h3>
                <button
                    onClick={() =>
                        error('Critical error - this alert cannot be dismissed.', {
                            dismissible: false,
                            timeout: false,
                            title: 'Critical Error',
                        })
                    }
                    className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                >
                    Non-dismissible Alert
                </button>
            </div>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Custom Timeout</h3>
                <button
                    onClick={() =>
                        success('This will dismiss after 10 seconds.', {
                            timeout: 10000,
                        })
                    }
                    className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                >
                    10 Second Timeout
                </button>
            </div>
        </div>
    );
};

export default AlertExample;
