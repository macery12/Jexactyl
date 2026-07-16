import { useState } from 'react';
import { WebhookEvent } from '@/api/routes/admin/webhooks';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/outline';
import { Button } from '@/elements/button';
import WebhookEventCard from './WebhookEventCard';
import { toggleEventStatus } from '@/api/routes/admin/webhooks';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from '@/state/hooks';

interface Props {
    category: string;
    events: WebhookEvent[];
    onUpdate: () => void;
}

const categoryDescriptions: Record<string, string> = {
    ai: 'AI and automation related webhook events',
    alert: 'System alerts and notifications',
    'api-keys': 'API key management events',
    auth: 'Authentication and authorization events',
    billing: 'Billing, payments, and product management',
    'database-hosts': 'Database host configuration events',
    eggs: 'Egg template management events',
    link: 'Link management events',
    mounts: 'Mount configuration events',
    nests: 'Nest management events',
    nodes: 'Node infrastructure events',
    servers: 'Server lifecycle and management events',
    'server-presets': 'Server preset template events',
    tickets: 'Support ticket system events',
    users: 'User account management events',
    webhooks: 'Webhook system configuration events',
};

export default ({ category, events, onUpdate }: Props) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const { clearFlashes, addFlash, clearAndAddHttpError } = useFlash();
    const { colors } = useStoreState(s => s.theme.data!);

    const enabledCount = events.filter(e => e.enabled).length;
    const totalCount = events.length;

    const handleEnableAll = async () => {
        setIsLoading(true);
        clearFlashes();

        try {
            // Enable each event in this category
            for (const event of events) {
                if (!event.enabled) {
                    await toggleEventStatus(true, event.id);
                }
            }
            addFlash({
                key: 'admin:webhooks',
                type: 'success',
                message: `All ${category} webhooks enabled successfully.`,
            });
            onUpdate();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:webhooks', error });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisableAll = async () => {
        setIsLoading(true);
        clearFlashes();

        try {
            // Disable each event in this category
            for (const event of events) {
                if (event.enabled) {
                    await toggleEventStatus(false, event.id);
                }
            }
            addFlash({
                key: 'admin:webhooks',
                type: 'success',
                message: `All ${category} webhooks disabled successfully.`,
            });
            onUpdate();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:webhooks', error });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={'mb-6 rounded-lg border border-neutral-700'} style={{ backgroundColor: colors.background }}>
            {/* Category Header */}
            <div
                className={'flex cursor-pointer items-center justify-between rounded-t-lg px-6 py-4 transition-colors'}
                style={{ backgroundColor: colors.headers }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className={'flex items-center space-x-3'}>
                    {isExpanded ? (
                        <ChevronDownIcon className={'h-5 w-5 text-neutral-400'} />
                    ) : (
                        <ChevronRightIcon className={'h-5 w-5 text-neutral-400'} />
                    )}
                    <div>
                        <h3 className={'text-lg font-semibold capitalize text-neutral-50'}>
                            {category.replace(/-/g, ' ')}
                        </h3>
                        <p className={'text-sm text-neutral-400'}>
                            {categoryDescriptions[category] || `Webhook events for ${category}`}
                        </p>
                    </div>
                </div>

                <div className={'flex items-center space-x-4'}>
                    <div className={'text-right'}>
                        <div className={'text-sm font-medium text-neutral-300'}>
                            {enabledCount} / {totalCount} Active
                        </div>
                        <div className={'text-xs text-neutral-500'}>
                            {totalCount === 1 ? '1 event' : `${totalCount} events`}
                        </div>
                    </div>

                    <div
                        className={'flex space-x-2'}
                        onClick={e => {
                            e.stopPropagation();
                        }}
                    >
                        <Button.Text
                            size={Button.Sizes.Small}
                            onClick={handleEnableAll}
                            disabled={isLoading || enabledCount === totalCount}
                        >
                            Enable All
                        </Button.Text>
                        <Button.Text
                            size={Button.Sizes.Small}
                            onClick={handleDisableAll}
                            disabled={isLoading || enabledCount === 0}
                            variant={Button.Variants.Secondary}
                        >
                            Disable All
                        </Button.Text>
                    </div>
                </div>
            </div>

            {/* Category Content */}
            {isExpanded && (
                <div className={'grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-3'}>
                    {events.map(event => (
                        <WebhookEventCard key={event.id} event={event} onUpdate={onUpdate} />
                    ))}
                </div>
            )}
        </div>
    );
};
