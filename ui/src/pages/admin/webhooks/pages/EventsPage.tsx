import { m } from '@/i18n';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, LayoutGrid, CheckCircle2, XCircle, Tag, Send } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getWebhookEvents,
    toggleWebhookEvent,
    sendTestWebhook,
    eventCategory,
    type WebhookEvent,
} from '@/api/webhooks';
import { EventCategorySection } from '../EventCategorySection';
import { webhookConfig } from '../WebhooksSection';

const KEY = ['admin', 'webhooks', 'events'] as const;

function StatTile({
    icon: Icon,
    label,
    value,
    sub,
    tone,
}: {
    icon: typeof LayoutGrid;
    label: string;
    value: number | string;
    sub?: string;
    tone?: 'accent' | 'muted';
}) {
    return (
        <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-4">
            <div className="min-w-0">
                <p className="text-xs text-[var(--color-ink-muted)]">{label}</p>
                <p
                    className={
                        tone === 'accent'
                            ? 'mt-1 text-2xl font-semibold text-[var(--color-accent)]'
                            : 'mt-1 text-2xl font-semibold text-[var(--color-ink)]'
                    }
                >
                    {value}
                </p>
                {sub && <p className="text-[11px] text-[var(--color-ink-faint)]">{sub}</p>}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)]">
                <Icon
                    className={
                        tone === 'accent'
                            ? 'h-5 w-5 text-[var(--color-accent)]'
                            : 'h-5 w-5 text-[var(--color-ink-muted)]'
                    }
                />
            </div>
        </div>
    );
}

export default function EventsPage() {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const { urlConfigured } = webhookConfig();

    const [search, setSearch] = useState('');
    const [testing, setTesting] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);

    const eventsQ = useQuery({ queryKey: KEY, queryFn: getWebhookEvents });
    const events = eventsQ.data;

    const patch = (updater: (e: WebhookEvent) => WebhookEvent) =>
        qc.setQueryData<WebhookEvent[]>([...KEY], prev => prev?.map(updater));

    // Optimistically flip a single event, reverting the cache on failure.
    const toggleEvent = async (id: number, enabled: boolean) => {
        const prev = qc.getQueryData<WebhookEvent[]>([...KEY]);
        patch(e => (e.id === id ? { ...e, enabled } : e));
        try {
            await toggleWebhookEvent(enabled, id);
        } catch (err) {
            qc.setQueryData([...KEY], prev);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        }
    };

    // Flip every event in a category that isn't already in the target state.
    const toggleCategory = async (group: WebhookEvent[], enabled: boolean) => {
        const ids = group.filter(e => e.enabled !== enabled).map(e => e.id);
        if (ids.length === 0) return;
        const prev = qc.getQueryData<WebhookEvent[]>([...KEY]);
        patch(e => (ids.includes(e.id) ? { ...e, enabled } : e));
        try {
            await Promise.all(ids.map(id => toggleWebhookEvent(enabled, id)));
        } catch (err) {
            qc.setQueryData([...KEY], prev);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        }
    };

    // Single request toggles every event (backend loops when no id is given).
    const toggleAll = async (enabled: boolean) => {
        setBulkBusy(true);
        const prev = qc.getQueryData<WebhookEvent[]>([...KEY]);
        patch(e => ({ ...e, enabled }));
        try {
            await toggleWebhookEvent(enabled);
            push({
                type: 'success',
                message: enabled
                    ? m['admin.webhooks.events.allEnabled']()
                    : m['admin.webhooks.events.allDisabled'](),
            });
        } catch (err) {
            qc.setQueryData([...KEY], prev);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setBulkBusy(false);
        }
    };

    const test = async () => {
        setTesting(true);
        try {
            await sendTestWebhook();
            push({ type: 'success', message: m['admin.webhooks.config.testSent']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setTesting(false);
        }
    };

    const filtered = useMemo(() => {
        if (!events) return [];
        const q = search.trim().toLowerCase();
        if (!q) return events;
        return events.filter(
            e => e.key.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
        );
    }, [events, search]);

    const grouped = useMemo(() => {
        const map = new Map<string, WebhookEvent[]>();
        for (const e of filtered) {
            const cat = eventCategory(e.key);
            (map.get(cat) ?? map.set(cat, []).get(cat)!).push(e);
        }
        return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [filtered]);

    if (eventsQ.isLoading || !events) return <FullPageSpinner />;

    const total = filtered.length;
    const enabled = filtered.filter(e => e.enabled).length;
    const disabled = total - enabled;
    const pct = total > 0 ? Math.round((enabled / total) * 100) : 0;
    const categories = new Set(filtered.map(e => eventCategory(e.key))).size;

    return (
        <div className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile icon={LayoutGrid} label={m['admin.webhooks.events.stats.total']()} value={total} />
                <StatTile
                    icon={CheckCircle2}
                    label={m['admin.webhooks.events.stats.enabled']()}
                    value={enabled}
                    sub={m['admin.webhooks.events.stats.active']({ percent: pct })}
                    tone="accent"
                />
                <StatTile
                    icon={XCircle}
                    label={m['admin.webhooks.events.stats.disabled']()}
                    value={disabled}
                    sub={m['admin.webhooks.events.stats.inactive']({ percent: 100 - pct })}
                />
                <StatTile
                    icon={Tag}
                    label={m['admin.webhooks.events.stats.categories']()}
                    value={categories}
                    sub={
                        urlConfigured
                            ? m['admin.webhooks.events.stats.urlSet']()
                            : m['admin.webhooks.events.stats.urlUnset']()
                    }
                />
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative lg:max-w-md lg:flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={m['admin.webhooks.events.search']()}
                        className="pl-10"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={test} disabled={testing}>
                        <Send className="h-4 w-4" />
                        {m['admin.webhooks.config.actions.test']()}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => toggleAll(false)} disabled={bulkBusy}>
                        {m['admin.webhooks.events.disableAll']()}
                    </Button>
                    <Button size="sm" onClick={() => toggleAll(true)} disabled={bulkBusy}>
                        {m['admin.webhooks.events.enableAll']()}
                    </Button>
                </div>
            </div>

            {grouped.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-10 text-center">
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.webhooks.events.empty']()}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {grouped.map(([category, group]) => (
                        <EventCategorySection
                            key={category}
                            category={category}
                            events={group}
                            onToggleEvent={toggleEvent}
                            onToggleCategory={toggleCategory}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
