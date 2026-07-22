import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { m, td } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { getProviderRules, updateProviderRules, type ProviderRule } from '@/api/marketplaceAdmin';

const PROVIDERS = ['modrinth', 'spigot', 'curseforge'];

// Per-provider access control. Each provider has a global on/off plus an egg
// allowlist (empty allowlist = available to every egg). Saved one provider at a
// time via the PUT endpoint.
export default function ProvidersPage() {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const rulesQ = useQuery({ queryKey: ['admin', 'marketplace', 'providers'], queryFn: getProviderRules });

    const [provider, setProvider] = useState('modrinth');
    const [draft, setDraft] = useState<ProviderRule | null>(null);

    // (Re)seed the draft when the provider changes or data (re)loads.
    useEffect(() => {
        if (!rulesQ.data) return;
        const existing = rulesQ.data.rules[provider];
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setDraft(
            existing
                ? { ...existing, allowed_egg_ids: [...(existing.allowed_egg_ids ?? [])] }
                : { provider_key: provider, enabled_global: true, allowed_egg_ids: [] },
        );
    }, [provider, rulesQ.data]);

    const saved = rulesQ.data?.rules[provider];
    const dirty = useMemo(() => draft && JSON.stringify(draft) !== JSON.stringify(saved ?? draft), [draft, saved]);

    const save = useMutation({
        mutationFn: (rule: ProviderRule) => updateProviderRules(rule),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'marketplace', 'providers'] });
            push({ type: 'success', message: m['admin.marketplace.providers.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['admin.marketplace.settings.error']() }),
    });

    if (rulesQ.isLoading || !draft) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const allowed = new Set(draft.allowed_egg_ids ?? []);
    const toggleEgg = (eggId: number) => {
        const next = new Set(allowed);
        if (next.has(eggId)) next.delete(eggId);
        else next.add(eggId);
        setDraft({ ...draft, allowed_egg_ids: [...next] });
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
                    {PROVIDERS.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setProvider(p)}
                            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                provider === p
                                    ? 'bg-[var(--brand)]/15 text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
                            }`}
                        >
                            {td(`server.mods.provider.${p}`, p)}
                        </button>
                    ))}
                </div>
                <Button size="sm" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
                    {save.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {m['admin.marketplace.settings.save']()}
                </Button>
            </div>

            <Panel title={m['admin.marketplace.providers.global']()}>
                <div className="flex items-start justify-between gap-4 p-1">
                    <div>
                        <p className="text-sm font-medium text-[var(--color-ink)]">
                            {m['admin.marketplace.providers.enabledGlobal']()}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                            {m['admin.marketplace.providers.enabledGlobalHint']()}
                        </p>
                    </div>
                    <Switch
                        checked={draft.enabled_global}
                        onChange={v => setDraft({ ...draft, enabled_global: v })}
                    />
                </div>
            </Panel>

            <Panel title={m['admin.marketplace.providers.allowlist']()}>
                <div className="flex flex-col gap-4 p-1">
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.marketplace.providers.allowlistHint']()}</p>
                    {rulesQ.data!.nests.map(nest => (
                        <div key={nest.id}>
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                                {nest.name}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {(nest.eggs ?? []).map(egg => {
                                    const on = allowed.has(egg.id);
                                    return (
                                        <button
                                            key={egg.id}
                                            type="button"
                                            onClick={() => toggleEgg(egg.id)}
                                            disabled={!draft.enabled_global}
                                            className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
                                                on
                                                    ? 'border-[var(--brand)]/50 bg-[var(--brand)]/15 text-[var(--color-ink)]'
                                                    : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]'
                                            }`}
                                        >
                                            {egg.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </Panel>
        </div>
    );
}
