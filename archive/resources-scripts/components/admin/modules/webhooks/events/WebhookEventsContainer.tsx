import { useEffect, useState } from 'react';
import Spinner from '@/elements/Spinner';
import { getEvents, sendTestEvent, toggleEventStatus, WebhookEvent } from '@/api/routes/admin/webhooks';
import { Button } from '@/elements/button';
import useFlash from '@/plugins/useFlash';
import Input from '@/elements/Input';
import WebhookCategorySection from '../WebhookCategorySection';
import WebhookStatistics from '../WebhookStatistics';

export default () => {
    const [events, setEvents] = useState<WebhookEvent[]>();
    const [filteredEvents, setFilteredEvents] = useState<WebhookEvent[]>();
    const [searchTerm, setSearchTerm] = useState<string>('');
    const { clearFlashes, addFlash, clearAndAddHttpError } = useFlash();

    const loadEvents = () => {
        getEvents().then(fetchedEvents => {
            setEvents(fetchedEvents);
            setFilteredEvents(fetchedEvents);
        });
    };

    useEffect(() => {
        loadEvents();
    }, []);

    const handleSearch = (searchValue: string) => {
        setSearchTerm(searchValue);

        if (events) {
            const filtered = events.filter(
                event =>
                    event.key.toLowerCase().includes(searchValue.toLowerCase()) ||
                    event.description.toLowerCase().includes(searchValue.toLowerCase()),
            );
            setFilteredEvents(filtered);
        }
    };

    const doDisable = async () => {
        clearFlashes();
        try {
            await toggleEventStatus(false);
            addFlash({ key: 'admin:webhooks', type: 'success', message: 'All webhooks disabled successfully!' });
            loadEvents();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:webhooks', error });
        }
    };

    const doEnable = async () => {
        clearFlashes();
        try {
            await toggleEventStatus(true);
            addFlash({ key: 'admin:webhooks', type: 'success', message: 'All webhooks enabled successfully!' });
            loadEvents();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:webhooks', error });
        }
    };

    const doTest = () => {
        clearFlashes();

        sendTestEvent()
            .then(() => {
                addFlash({ key: 'admin:webhooks', type: 'success', message: 'Test webhook sent successfully!' });
            })
            .catch(error => clearAndAddHttpError({ key: 'admin:webhooks', error }));
    };

    if (!events || !filteredEvents) return <Spinner size={'large'} centered />;

    // Group events by category
    const categorizedEvents = filteredEvents.reduce(
        (acc, event) => {
            const category = event.key.split(':')[1] ?? 'unknown'; // Extract category from key like "admin:billing:update"
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(event);
            return acc;
        },
        {} as Record<string, WebhookEvent[]>,
    );

    // Sort categories alphabetically
    const sortedCategories = Object.keys(categorizedEvents).sort();

    return (
        <>
            {/* Statistics Dashboard */}
            <WebhookStatistics events={filteredEvents} />

            {/* Search and Actions Bar */}
            <div className={'mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'}>
                <div className={'flex-1 lg:max-w-md'}>
                    <Input
                        placeholder={'Search webhook events by name or description...'}
                        value={searchTerm}
                        onChange={e => handleSearch(e.target.value)}
                    />
                </div>

                <div className={'flex flex-wrap gap-2'}>
                    <Button.Text onClick={doTest} variant={Button.Variants.Secondary}>
                        Send Test Event
                    </Button.Text>
                    <Button.Danger onClick={doDisable}>Disable All Webhooks</Button.Danger>
                    <Button onClick={doEnable}>Enable All Webhooks</Button>
                </div>
            </div>

            {/* Categorized Webhook Events */}
            <div>
                {sortedCategories.length === 0 ? (
                    <div className={'rounded-lg border border-neutral-700 bg-neutral-800 p-8 text-center'}>
                        <p className={'text-neutral-400'}>No webhook events found matching &quot;{searchTerm}&quot;</p>
                    </div>
                ) : (
                    sortedCategories.map(category => (
                        <WebhookCategorySection
                            key={category}
                            category={category}
                            events={categorizedEvents[category] ?? []}
                            onUpdate={loadEvents}
                        />
                    ))
                )}
            </div>
        </>
    );
};
