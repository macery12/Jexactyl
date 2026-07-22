import { useMemo, useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { m } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { mibToBytes } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { useFlags } from '@/state/flags';
import { updateMarketplaceSettings, type MarketplaceSettings } from '@/api/marketplaceAdmin';

// Read shape of the mods block in the injected Everest config.
interface ModsFlag {
    enabled?: boolean;
    default_source?: string;
    allow_external_downloads?: boolean;
    curseforge_cdn_fallback?: boolean;
    curseforge?: { enabled?: boolean; configured?: boolean };
    download?: {
        max_concurrent_per_server?: number;
        max_per_minute_per_user?: number;
        max_queue_size_per_server?: number;
        max_mod_size_mb?: number;
        max_plugin_size_mb?: number;
    };
}

// Editable form model. Sizes are edited in MB and converted to bytes on save;
// the CurseForge key is write-only (blank means "leave unchanged").
interface Form {
    enabled: boolean;
    default_source: string;
    allow_external_downloads: boolean;
    curseforge_enabled: boolean;
    curseforge_cdn_fallback: boolean;
    curseforge_api_key: string;
    download_max_concurrent: number;
    download_max_per_minute: number;
    download_max_queue_size: number;
    max_mod_size_mb: number;
    max_plugin_size_mb: number;
}

function toForm(s: ModsFlag): Form {
    const src = s.default_source === 'spiget' ? 'spigot' : s.default_source ?? 'modrinth';
    return {
        enabled: !!s.enabled,
        default_source: src,
        allow_external_downloads: !!s.allow_external_downloads,
        curseforge_enabled: !!s.curseforge?.enabled,
        curseforge_cdn_fallback: s.curseforge_cdn_fallback ?? true,
        curseforge_api_key: '',
        download_max_concurrent: s.download?.max_concurrent_per_server ?? 3,
        download_max_per_minute: s.download?.max_per_minute_per_user ?? 10,
        download_max_queue_size: s.download?.max_queue_size_per_server ?? 20,
        max_mod_size_mb: s.download?.max_mod_size_mb ?? 150,
        max_plugin_size_mb: s.download?.max_plugin_size_mb ?? 100,
    };
}

export default function SettingsPage() {
    const push = useFlashes(s => s.push);
    const modsFlag = useFlags(s => s.everest?.mods) as ModsFlag | undefined;

    const [form, setForm] = useState<Form | null>(null);
    const [saved, setSaved] = useState<Form | null>(null);
    const keySet = !!modsFlag?.curseforge?.configured;

    useEffect(() => {
        if (modsFlag && !form) {
            const f = toForm(modsFlag);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
            setForm(f);
            setSaved(f);
        }
    }, [modsFlag, form]);

    const dirty = useMemo(() => form && saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

    const save = useMutation({
        mutationFn: (f: Form) => {
            const payload: MarketplaceSettings = {
                enabled: f.enabled,
                default_source: f.default_source,
                allow_external_downloads: f.allow_external_downloads,
                curseforge_enabled: f.curseforge_enabled,
                curseforge_cdn_fallback: f.curseforge_cdn_fallback,
                download_max_concurrent: f.download_max_concurrent,
                download_max_per_minute: f.download_max_per_minute,
                download_max_queue_size: f.download_max_queue_size,
                max_mod_size: mibToBytes(f.max_mod_size_mb),
                max_plugin_size: mibToBytes(f.max_plugin_size_mb),
            };
            if (f.curseforge_api_key.trim()) payload.curseforge_api_key = f.curseforge_api_key.trim();
            return updateMarketplaceSettings(payload);
        },
        onSuccess: (_r, f) => {
            const cleared = { ...f, curseforge_api_key: '' };
            setForm(cleared);
            setSaved(cleared);
            push({ type: 'success', message: m['admin.marketplace.settings.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['admin.marketplace.settings.error']() }),
    });

    if (!form) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const set = (patch: Partial<Form>) => setForm(f => (f ? { ...f, ...patch } : f));

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center justify-end">
                <Button size="sm" onClick={() => save.mutate(form)} disabled={!dirty || save.isPending}>
                    {save.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {m['admin.marketplace.settings.save']()}
                </Button>
            </div>

            <Panel title={m['admin.marketplace.settings.general']()}>
                <div className="flex flex-col gap-4 p-1">
                    <ToggleRow
                        label={m['admin.marketplace.settings.enabled']()}
                        hint={m['admin.marketplace.settings.enabledHint']()}
                        checked={form.enabled}
                        onChange={v => set({ enabled: v })}
                    />
                    <Field label={m['admin.marketplace.settings.defaultSource']()}>
                        <Select
                            value={form.default_source}
                            onChange={v => set({ default_source: v })}
                            options={[
                                { value: 'modrinth', label: 'Modrinth' },
                                { value: 'spigot', label: 'Spigot' },
                            ]}
                        />
                    </Field>
                    <ToggleRow
                        label={m['admin.marketplace.settings.externalDownloads']()}
                        hint={m['admin.marketplace.settings.externalDownloadsHint']()}
                        checked={form.allow_external_downloads}
                        onChange={v => set({ allow_external_downloads: v })}
                    />
                </div>
            </Panel>

            <Panel title={m['admin.marketplace.settings.curseforge']()}>
                <div className="flex flex-col gap-4 p-1">
                    <ToggleRow
                        label={m['admin.marketplace.settings.curseforgeEnabled']()}
                        hint={m['admin.marketplace.settings.curseforgeEnabledHint']()}
                        checked={form.curseforge_enabled}
                        onChange={v => set({ curseforge_enabled: v })}
                    />
                    <Field
                        label={m['admin.marketplace.settings.apiKey']()}
                        hint={keySet ? m['admin.marketplace.settings.apiKeySet']() : m['admin.marketplace.settings.apiKeyHint']()}
                    >
                        <Input
                            type="password"
                            value={form.curseforge_api_key}
                            onChange={e => set({ curseforge_api_key: e.target.value })}
                            placeholder={keySet ? '••••••••••••' : ''}
                            autoComplete="off"
                        />
                    </Field>
                    <ToggleRow
                        label={m['admin.marketplace.settings.cdnFallback']()}
                        hint={m['admin.marketplace.settings.cdnFallbackHint']()}
                        checked={form.curseforge_cdn_fallback}
                        onChange={v => set({ curseforge_cdn_fallback: v })}
                    />
                </div>
            </Panel>

            <Panel title={m['admin.marketplace.settings.limits']()}>
                <div className="grid grid-cols-1 gap-4 p-1 sm:grid-cols-3">
                    <NumberField
                        label={m['admin.marketplace.settings.maxConcurrent']()}
                        value={form.download_max_concurrent}
                        onChange={v => set({ download_max_concurrent: v })}
                    />
                    <NumberField
                        label={m['admin.marketplace.settings.maxPerMinute']()}
                        value={form.download_max_per_minute}
                        onChange={v => set({ download_max_per_minute: v })}
                    />
                    <NumberField
                        label={m['admin.marketplace.settings.maxQueue']()}
                        value={form.download_max_queue_size}
                        onChange={v => set({ download_max_queue_size: v })}
                    />
                    <NumberField
                        label={m['admin.marketplace.settings.maxModSize']()}
                        value={form.max_mod_size_mb}
                        onChange={v => set({ max_mod_size_mb: v })}
                    />
                    <NumberField
                        label={m['admin.marketplace.settings.maxPluginSize']()}
                        value={form.max_plugin_size_mb}
                        onChange={v => set({ max_plugin_size_mb: v })}
                    />
                </div>
            </Panel>
        </div>
    );
}

function ToggleRow({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">{label}</p>
                {hint && <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{hint}</p>}
            </div>
            <Switch checked={checked} onChange={onChange} />
        </div>
    );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <Field label={label}>
            <Input
                type="number"
                min={0}
                value={value}
                onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
            />
        </Field>
    );
}
