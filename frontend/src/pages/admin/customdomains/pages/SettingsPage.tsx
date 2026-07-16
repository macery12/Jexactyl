import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getCustomDomainSettings,
    updateCustomDomainSettings,
    type CustomDomainSettings,
} from '@/api/adminCustomDomains';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
            {description && <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{description}</p>}
            <div className="mt-4 flex flex-col gap-4">{children}</div>
        </section>
    );
}

function numberField(value: string, fallback: number): number {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export default function SettingsPage() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['admin', 'custom-domains', 'settings'];

    const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: getCustomDomainSettings });

    const [form, setForm] = useState<CustomDomainSettings | null>(null);
    useEffect(() => {
        if (data) setForm(data);
    }, [data]);

    const save = useMutation({
        mutationFn: (payload: CustomDomainSettings) =>
            updateCustomDomainSettings({
                enabled: payload.enabled,
                cloudflare_token: payload.cloudflareToken,
                allow_wildcard: payload.allowWildcard,
                max_wildcards_per_user: payload.maxWildcardsPerUser,
                rate_limit_create_per_minute: payload.rateLimitCreatePerMinute,
                rate_limit_sync_per_minute: payload.rateLimitSyncPerMinute,
                rate_limit_billing_options_per_minute: payload.rateLimitBillingOptionsPerMinute,
            }),
        onSuccess: () => {
            push({ type: 'success', message: m['admin.customDomains.settings.saved']() });
            qc.invalidateQueries({ queryKey: key });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    if (isLoading || !form) {
        return isError ? (
            <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['admin.customDomains.loadError']()}</p>
        ) : (
            <div className="flex justify-center py-14">
                <Spinner className="h-5 w-5" />
            </div>
        );
    }

    const patch = (next: Partial<CustomDomainSettings>) => setForm(f => (f ? { ...f, ...next } : f));

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{m['admin.customDomains.settings.title']()}</h2>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.customDomains.settings.subtitle']()}</p>
            </div>

            {!form.enabled && (
                <div className="flex gap-2.5 rounded-[var(--radius-card)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-4 py-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.customDomains.settings.disabledNotice']()}</p>
                </div>
            )}

            <SectionCard title={m['admin.customDomains.settings.moduleTitle']()}>
                <label className="flex items-center justify-between gap-4">
                    <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--color-ink)]">
                            {m['admin.customDomains.settings.enabledLabel']()}
                        </span>
                        <span className="block text-xs text-[var(--color-ink-muted)]">
                            {m['admin.customDomains.settings.enabledHint']()}
                        </span>
                    </span>
                    <Switch checked={form.enabled} onChange={v => patch({ enabled: v })} />
                </label>
                <Field
                    label={m['admin.customDomains.settings.tokenLabel']()}
                    hint={m['admin.customDomains.settings.tokenHint']()}
                    htmlFor="cd-token"
                >
                    <Input
                        id="cd-token"
                        type="password"
                        value={form.cloudflareToken}
                        onChange={e => patch({ cloudflareToken: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </Field>
            </SectionCard>

            <SectionCard title={m['admin.customDomains.settings.wildcardTitle']()}>
                <label className="flex items-center justify-between gap-4">
                    <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--color-ink)]">
                            {m['admin.customDomains.settings.allowWildcardLabel']()}
                        </span>
                        <span className="block text-xs text-[var(--color-ink-muted)]">
                            {m['admin.customDomains.settings.allowWildcardHint']()}
                        </span>
                    </span>
                    <Switch checked={form.allowWildcard} onChange={v => patch({ allowWildcard: v })} />
                </label>
                <Field label={m['admin.customDomains.settings.maxWildcardsLabel']()} htmlFor="cd-maxwild">
                    <Input
                        id="cd-maxwild"
                        type="number"
                        min={0}
                        value={String(form.maxWildcardsPerUser)}
                        onChange={e => patch({ maxWildcardsPerUser: numberField(e.target.value, 1) })}
                    />
                </Field>
            </SectionCard>

            <SectionCard
                title={m['admin.customDomains.settings.rateLimitsTitle']()}
                description={m['admin.customDomains.settings.rateLimitsHint']()}
            >
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={m['admin.customDomains.settings.rateCreate']()} htmlFor="cd-rl-create">
                        <Input
                            id="cd-rl-create"
                            type="number"
                            min={0}
                            value={String(form.rateLimitCreatePerMinute)}
                            onChange={e => patch({ rateLimitCreatePerMinute: numberField(e.target.value, 10) })}
                        />
                    </Field>
                    <Field label={m['admin.customDomains.settings.rateSync']()} htmlFor="cd-rl-sync">
                        <Input
                            id="cd-rl-sync"
                            type="number"
                            min={0}
                            value={String(form.rateLimitSyncPerMinute)}
                            onChange={e => patch({ rateLimitSyncPerMinute: numberField(e.target.value, 5) })}
                        />
                    </Field>
                    <Field label={m['admin.customDomains.settings.rateBilling']()} htmlFor="cd-rl-billing">
                        <Input
                            id="cd-rl-billing"
                            type="number"
                            min={0}
                            value={String(form.rateLimitBillingOptionsPerMinute)}
                            onChange={e => patch({ rateLimitBillingOptionsPerMinute: numberField(e.target.value, 20) })}
                        />
                    </Field>
                </div>
            </SectionCard>

            <div className="flex justify-end">
                <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
                    {save.isPending && <Spinner className="h-4 w-4" />}
                    {m['common.actions.saveChanges']()}
                </Button>
            </div>
        </div>
    );
}
