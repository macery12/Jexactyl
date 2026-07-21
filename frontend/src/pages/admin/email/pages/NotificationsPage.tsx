import { m } from '@/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/Switch';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getNotificationSettings,
    updateNotificationSetting,
    type EmailNotificationSetting,
    type NotificationSettingsResponse,
} from '@/api/email';
import { SettingsCard, TonePill } from '../parts';

const NOTIF_KEY = ['admin', 'email', 'notifications'] as const;

// Per-template notification toggles, grouped by category. Toggling is optimistic
// against the react-query cache and reverts on error.
export default function NotificationsPage() {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);

    const query = useQuery({ queryKey: NOTIF_KEY, queryFn: getNotificationSettings });

    const mutation = useMutation({
        mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateNotificationSetting(id, enabled),
        onMutate: async ({ id, enabled }) => {
            await qc.cancelQueries({ queryKey: NOTIF_KEY });
            const prev = qc.getQueryData<NotificationSettingsResponse>(NOTIF_KEY);
            if (prev) {
                const next: NotificationSettingsResponse = {
                    categories: Object.fromEntries(
                        Object.entries(prev.categories).map(([cat, items]) => [
                            cat,
                            items.map(i => (i.id === id ? { ...i, enabled } : i)),
                        ]),
                    ),
                };
                qc.setQueryData(NOTIF_KEY, next);
            }
            return { prev };
        },
        onError: (err, _vars, ctx) => {
            if (ctx?.prev) qc.setQueryData(NOTIF_KEY, ctx.prev);
            push({ type: 'error', message: firstError(err) ?? m['admin.email.notifications.saveError']() });
        },
    });

    if (query.isLoading || !query.data) return <FullPageSpinner />;

    const categories = Object.entries(query.data.categories);

    if (categories.length === 0) {
        return (
            <SettingsCard title={m['admin.email.notifications.title']()} description={m['admin.email.notifications.desc']()}>
                <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.email.notifications.empty']()}</p>
            </SettingsCard>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{m['admin.email.notifications.title']()}</h2>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.email.notifications.desc']()}</p>
            </div>
            {categories.map(([category, items]) => (
                <SettingsCard key={category} title={category}>
                    <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                        {items.map(item => (
                            <Row
                                key={item.id}
                                item={item}
                                onToggle={enabled => mutation.mutate({ id: item.id, enabled })}
                                exemptLabel={m['admin.email.notifications.exempt']()}
                            />
                        ))}
                    </ul>
                </SettingsCard>
            ))}
        </div>
    );
}

function Row({
    item,
    onToggle,
    exemptLabel,
}: {
    item: EmailNotificationSetting;
    onToggle: (enabled: boolean) => void;
    exemptLabel: string;
}) {
    return (
        <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-ink)]">{item.name}</span>
                    {item.rate_limit_exempt && <TonePill tone="neutral">{exemptLabel}</TonePill>}
                </div>
                {item.description && (
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{item.description}</p>
                )}
                <code className="mt-1 inline-block rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-faint)]">
                    {item.template_key}
                </code>
            </div>
            <Switch checked={item.enabled} onChange={onToggle} label={item.name} />
        </li>
    );
}
