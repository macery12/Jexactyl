import { useStoreState } from '@/state/hooks';
import ContentBox from '@/elements/ContentBox';
import { BillingAnalytics } from '@definitions/admin';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCheckCircle,
    faExclamationTriangle,
    faTimesCircle,
    faCopy,
    faCheck,
} from '@fortawesome/free-solid-svg-icons';
import { faCcStripe, faCcPaypal } from '@fortawesome/free-brands-svg-icons';
import { useState } from 'react';

interface BillingHealthSummaryProps {
    data: BillingAnalytics;
    history: number;
}

export default ({ data }: BillingHealthSummaryProps) => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const [copiedUUID, setCopiedUUID] = useState<string | null>(null);

    // Get suspended servers details
    const suspendedServers = data.suspendedServers || [];

    const copyToClipboard = (uuid: string) => {
        navigator.clipboard.writeText(uuid);
        setCopiedUUID(uuid);
        setTimeout(() => setCopiedUUID(null), 2000);
    };

    // Payment provider status
    const providers = [
        {
            name: 'Stripe',
            icon: faCcStripe,
            enabled: settings.processors?.stripe?.enabled || false,
            configured: settings.keys?.publishable && settings.keys?.secret,
        },
        {
            name: 'PayPal',
            icon: faCcPaypal,
            enabled: settings.processors?.paypal?.enabled || false,
            configured: settings.processors?.paypal?.available || false,
            mode: settings.paypal_standalone?.mode,
        },
    ];

    const getProviderStatus = (provider: (typeof providers)[0]) => {
        // Special handling for PayPal - ignore webhook status, only check API key and mode
        if (provider.name === 'PayPal') {
            if (!provider.enabled) {
                return { icon: faTimesCircle, color: 'text-gray-500', label: 'Disabled' };
            }
            if (provider.configured && provider.mode === 'live') {
                return { icon: faCheckCircle, color: 'text-green-500', label: 'Active' };
            }
            if (provider.configured && provider.mode === 'sandbox') {
                return { icon: faExclamationTriangle, color: 'text-yellow-500', label: 'Sandbox Mode' };
            }
            if (provider.configured && !provider.mode) {
                return { icon: faExclamationTriangle, color: 'text-yellow-500', label: 'Partially Configured' };
            }
            return { icon: faTimesCircle, color: 'text-gray-500', label: 'Not Configured' };
        }

        // Default logic for other providers
        if (provider.enabled && provider.configured) {
            return { icon: faCheckCircle, color: 'text-green-500', label: 'Active' };
        } else if (provider.enabled && !provider.configured) {
            return { icon: faExclamationTriangle, color: 'text-yellow-500', label: 'Partially Configured' };
        } else {
            return { icon: faTimesCircle, color: 'text-gray-500', label: 'Disabled' };
        }
    };

    return (
        <ContentBox title="Billing Health" className="min-h-[160px]">
            <div className="space-y-4">
                {/* Billing Status */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Billing Module</span>
                    <div className="flex items-center gap-2">
                        <FontAwesomeIcon
                            icon={settings.enabled ? faCheckCircle : faTimesCircle}
                            className={settings.enabled ? 'text-green-500' : 'text-gray-500'}
                        />
                        <span className="text-sm font-medium">{settings.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                </div>

                {/* Payment Providers */}
                <div>
                    <h3 className="mb-2 text-sm font-medium text-gray-300">Payment Providers</h3>
                    <div className="space-y-2">
                        {providers.map(provider => {
                            const status = getProviderStatus(provider);
                            return (
                                <div key={provider.name} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <FontAwesomeIcon icon={provider.icon} className="text-gray-400" />
                                        <span className="text-sm text-gray-400">{provider.name}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <FontAwesomeIcon icon={status.icon} className={status.color} />
                                        <span className={`text-xs ${status.color}`}>{status.label}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Suspended Servers */}
                <div className="rounded border border-yellow-500/20 bg-yellow-500/10 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-300">Suspended Servers</span>
                        <span className="text-xl font-bold text-yellow-400">{suspendedServers.length}</span>
                    </div>
                    {suspendedServers.length > 0 ? (
                        <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">
                            {suspendedServers.map(server => (
                                <div
                                    key={server.id}
                                    className="rounded border border-gray-700/50 bg-gray-800/50 p-2 text-xs"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate font-medium text-gray-200" title={server.name}>
                                                {server.name}
                                            </div>
                                            <div className="mt-0.5 text-gray-400">
                                                Owner: <span className="text-gray-300">{server.owner}</span>
                                            </div>
                                            <div className="mt-1 flex items-center gap-1">
                                                <code className="block truncate font-mono text-[10px] text-gray-400">
                                                    {server.uuid}
                                                </code>
                                                <button
                                                    onClick={() => copyToClipboard(server.uuid)}
                                                    className="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-200"
                                                    title="Copy UUID"
                                                >
                                                    <FontAwesomeIcon
                                                        icon={copiedUUID === server.uuid ? faCheck : faCopy}
                                                        className={copiedUUID === server.uuid ? 'text-green-400' : ''}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-1 text-xs text-gray-500">No suspended servers</p>
                    )}
                </div>
            </div>
        </ContentBox>
    );
};
