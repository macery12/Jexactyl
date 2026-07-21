import { useState } from 'react';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faTimesCircle, faPuzzlePiece, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { createIntegrationRegistry } from './registry';
import { updateSettings } from '@/api/routes/admin/billing';
import FlashMessageRender from '@/elements/FlashMessageRender';

export default () => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const theme = useStoreState(s => s.theme.data!);
    const [loading, setLoading] = useState<string | null>(null);

    const integrations = createIntegrationRegistry(settings);

    const toggleIntegration = async (integrationId: string, currentState: boolean) => {
        setLoading(integrationId);
        try {
            const newState = !currentState;
            await updateSettings(`integrations:${integrationId}:enabled`, newState);

            // Reload the page to fetch updated settings from server
            window.location.reload();
        } catch (error) {
            console.error('Failed to toggle integration:', error);
            setLoading(null);
        }
    };

    return (
        <div>
            <FlashMessageRender byKey={'admin:billing:integrations'} className={'mb-4'} />

            <div className={'mb-6'}>
                <h3 className={'mb-2 text-xl font-medium text-neutral-50'}>Payment Integrations</h3>
                <p className={'text-base text-neutral-400'}>
                    Enable and configure payment integrations for your billing system. Multiple integrations can be
                    enabled simultaneously to provide more payment options to your users.
                </p>
            </div>

            <div className={'grid gap-4 lg:grid-cols-2'}>
                {integrations.map(integration => (
                    <AdminBox
                        key={integration.id}
                        title={integration.name}
                        icon={integration.icon}
                        className={'relative'}
                    >
                        <div className={'absolute top-4 right-4'}>
                            <span
                                className={
                                    'flex h-8 w-8 items-center justify-center rounded-full border border-black/30 shadow-md'
                                }
                                style={{ backgroundColor: theme.colors.headers }}
                            >
                                {integration.enabled ? (
                                    <FontAwesomeIcon icon={faCheckCircle} className={'text-lg text-green-500'} />
                                ) : (
                                    <FontAwesomeIcon icon={faTimesCircle} className={'text-lg text-gray-500'} />
                                )}
                            </span>
                        </div>

                        <p className={'mb-4 text-sm text-neutral-400'}>{integration.description}</p>

                        <div className={'mb-4'}>
                            <div className={'mb-2 flex items-center gap-2'}>
                                <span className={'text-sm font-medium text-neutral-300'}>Status:</span>
                                <span className={`text-sm ${integration.enabled ? 'text-green-500' : 'text-gray-500'}`}>
                                    {integration.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                            <div className={'flex items-center gap-2'}>
                                <span className={'text-sm font-medium text-neutral-300'}>Configuration:</span>
                                <span
                                    className={`text-sm ${
                                        integration.configured ? 'text-green-500' : 'text-yellow-500'
                                    }`}
                                >
                                    {integration.configured ? 'Complete' : 'Incomplete'}
                                </span>
                            </div>
                        </div>

                        <div className={'flex gap-2'}>
                            {integration.enabled ? (
                                <Button.Danger
                                    onClick={() => toggleIntegration(integration.id, integration.enabled)}
                                    disabled={loading === integration.id}
                                >
                                    {loading === integration.id ? 'Loading...' : 'Disable'}
                                </Button.Danger>
                            ) : (
                                <Button
                                    onClick={() => toggleIntegration(integration.id, integration.enabled)}
                                    disabled={loading === integration.id}
                                >
                                    {loading === integration.id ? 'Loading...' : 'Enable'}
                                </Button>
                            )}

                            {integration.enabled && !integration.configured && (
                                <p className={'flex items-center text-xs text-yellow-500'}>
                                    <FontAwesomeIcon icon={faExclamationTriangle} className={'mr-1'} /> Configure in the{' '}
                                    {integration.name} tab to start accepting payments
                                </p>
                            )}
                        </div>
                    </AdminBox>
                ))}
            </div>

            <div className={'mt-8 rounded-lg border border-blue-800/30 bg-blue-900/20 p-4'}>
                <div className={'flex items-start gap-3'}>
                    <FontAwesomeIcon icon={faPuzzlePiece} className={'mt-1 text-xl text-blue-400'} />
                    <div>
                        <h4 className={'mb-1 text-base font-medium text-blue-300'}>Adding New Integrations</h4>
                        <p className={'text-sm text-blue-200/80'}>
                            This modular system makes it easy to add new payment integrations in the future. Each
                            integration can be enabled independently and has its own configuration tab when enabled.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
