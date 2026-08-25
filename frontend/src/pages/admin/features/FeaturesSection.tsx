import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { ToggleRight, CreditCard, SlidersHorizontal, Monitor, Terminal, Check, AlertTriangle } from 'lucide-react';
import { m, td } from '@/i18n/messages';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { HelpButton, HelpSteps } from '@/components/ui/HelpButton';
import { useFlashes } from '@/state/flashes';
import { useFlags } from '@/state/flags';
import { firstError } from '@/lib/apiError';
import { cn } from '@/lib/cn';
import { getFeatures, updateFeatures } from '@/api/adminFeatures';
import {
    MODULE_FEATURES,
    BILLING_FEATURE,
    PRESETS,
    type FeatureDef,
    type FeatureFlags,
    type FeatureKey,
    applyFeatureFlags,
} from '@/features/registry';

function SectionCard({ icon: Icon, title, subtitle, action, children }: {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
                    <p className="text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function FeatureToggleRow({ def, checked, onChange }: {
    def: FeatureDef;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    const Icon = def.icon;
    return (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border-strong)] p-3.5 transition-colors hover:bg-[var(--color-surface-2)]">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-ink)]">{td(def.labelKey)}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{td(def.descKey)}</span>
            </span>
            <Switch checked={checked} onChange={onChange} className="mt-0.5" />
        </label>
    );
}

export default function FeaturesSection() {
    const push = useFlashes(s => s.push);
    const site = window.SiteConfiguration;

    const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'features'], queryFn: getFeatures });

    const [draft, setDraft] = useState<FeatureFlags | null>(null);
    const [saved, setSaved] = useState<FeatureFlags | null>(null);
    const [saving, setSaving] = useState(false);

    // Seed local editable state once the server state arrives.
    const flags = draft ?? data ?? null;
    if (data && draft === null) {
        setDraft(data);
        setSaved(data);
    }

    const dirty = useMemo(
        () => (flags && saved ? (Object.keys(flags) as FeatureKey[]).some(k => flags[k] !== saved[k]) : false),
        [flags, saved],
    );

    const setFeature = (key: FeatureKey, value: boolean) =>
        setDraft(d => (d ? { ...d, [key]: value } : d));

    const applyPreset = (preset: FeatureFlags) => setDraft(preset);

    const handleSave = async () => {
        if (!flags || saving) return;
        setSaving(true);
        try {
            const next = await updateFeatures(flags);
            setDraft(next);
            setSaved(next);
            // Fold the saved flags into the live bootstrap store so the sidebar
            // and route gates react immediately (no page reload for nav).
            const { everest, site: liveSite } = useFlags.getState();
            if (everest) useFlags.getState().set(applyFeatureFlags(everest, next), liveSite);
            push({ type: 'success', message: m['admin.features.saved']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['admin.settings.saveError']() });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.features.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.features.subtitle']()}</p>
                </div>
                <HelpButton title={m['admin.features.help.title']()} label={m['admin.features.help.label']()}>
                    <p className="mb-5 text-sm text-[var(--color-ink-muted)]">{m['admin.features.help.intro']()}</p>
                    <HelpSteps
                        steps={[
                            { title: m['admin.features.help.step1Title'](), body: m['admin.features.help.step1Body']() },
                            { title: m['admin.features.help.step2Title'](), body: m['admin.features.help.step2Body']() },
                            { title: m['admin.features.help.step3Title'](), body: m['admin.features.help.step3Body']() },
                            { title: m['admin.features.help.step4Title'](), body: m['admin.features.help.step4Body']() },
                        ]}
                    />
                </HelpButton>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : isError || !flags ? (
                <p className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                    {m['admin.features.loadError']()}
                </p>
            ) : (
                <>
                    <SectionCard
                        icon={ToggleRight}
                        title={m['admin.features.modules.title']()}
                        subtitle={m['admin.features.modules.subtitle']()}
                        action={
                            <div className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => applyPreset(PRESETS.bareMinimum)}>
                                    {m['admin.features.presets.bareMinimum']()}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => applyPreset(PRESETS.defaults)}>
                                    {m['admin.features.presets.defaults']()}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => applyPreset(PRESETS.everything)}>
                                    {m['admin.features.presets.everything']()}
                                </Button>
                            </div>
                        }
                    >
                        <div className="grid gap-3 md:grid-cols-2">
                            {MODULE_FEATURES.map(def => (
                                <FeatureToggleRow
                                    key={def.key}
                                    def={def}
                                    checked={flags[def.key]}
                                    onChange={v => setFeature(def.key, v)}
                                />
                            ))}
                        </div>
                    </SectionCard>

                    <SectionCard
                        icon={CreditCard}
                        title={m['admin.features.billing.title']()}
                        subtitle={m['admin.features.billing.subtitle']()}
                    >
                        <FeatureToggleRow
                            def={BILLING_FEATURE}
                            checked={flags.billing}
                            onChange={v => setFeature('billing', v)}
                        />
                        {!flags.billing && (
                            <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3.5 py-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                                <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
                                    {m['admin.features.billing.disabledNote']()}
                                </p>
                            </div>
                        )}
                    </SectionCard>

                    <PanelStateCard debug={site?.debug ?? false} mode={site?.mode ?? 'standard'} />

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.features.applyNote']()}</p>
                        <Button disabled={!dirty || saving} onClick={handleSave}>
                            {saving ? <Spinner className="h-4 w-4" /> : m['common.actions.saveChanges']()}
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}

function PanelStateCard({ debug, mode }: { debug: boolean; mode: string }) {
    const [debugOpen, setDebugOpen] = useState(false);

    return (
        <SectionCard
            icon={SlidersHorizontal}
            title={m['admin.features.state.title']()}
            subtitle={m['admin.features.state.subtitle']()}
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <StateCard
                    icon={Monitor}
                    title={m['admin.features.state.standard']()}
                    desc={m['admin.features.state.standardDesc']()}
                    active={mode === 'standard'}
                    activeLabel={m['admin.features.state.active']()}
                />
                <StateCard
                    icon={Terminal}
                    title={m['admin.features.state.debug']()}
                    desc={m['admin.features.state.debugDesc']()}
                    active={debug}
                    activeLabel={m['admin.features.state.envManaged']()}
                    onInfo={() => setDebugOpen(true)}
                />
            </div>

            <Modal open={debugOpen} onClose={() => setDebugOpen(false)} title={m['admin.features.state.debugDialogTitle']()} size="sm">
                <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.features.state.debugDialogIntro']()}</p>
                <ol className="mt-3 space-y-2 text-sm text-[var(--color-ink)]">
                    {[
                        m['admin.features.state.debugStep1'](),
                        m['admin.features.state.debugStep2'](),
                        m['admin.features.state.debugStep3'](),
                    ].map((step, i) => (
                        <li key={i} className="flex gap-2.5">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[11px] font-semibold text-[var(--color-ink-muted)]">
                                {i + 1}
                            </span>
                            <span>{step}</span>
                        </li>
                    ))}
                </ol>
            </Modal>
        </SectionCard>
    );
}

function StateCard({ icon: Icon, title, desc, active, activeLabel, onInfo }: {
    icon: LucideIcon;
    title: string;
    desc: string;
    active: boolean;
    activeLabel: string;
    onInfo?: () => void;
}) {
    return (
        <div
            className={cn(
                'flex flex-col rounded-lg border p-4 transition-colors',
                active ? 'border-[var(--brand)] bg-[var(--brand)]/8' : 'border-[var(--color-border-strong)]',
            )}
        >
            <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                    <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
            </div>
            <p className="mt-2.5 flex-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">{desc}</p>
            <div className="mt-4 flex items-center justify-between">
                {active ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
                        <Check className="h-3.5 w-3.5" />
                        {activeLabel}
                    </span>
                ) : (
                    <span className="text-xs text-[var(--color-ink-faint)]">{td('common.states.disabled', 'Disabled')}</span>
                )}
                {onInfo && (
                    <Button variant="ghost" size="sm" onClick={onInfo}>
                        {m['admin.features.state.howTo']()}
                    </Button>
                )}
            </div>
        </div>
    );
}
