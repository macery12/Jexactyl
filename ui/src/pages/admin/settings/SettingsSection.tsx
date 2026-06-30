import { m, setLocale } from '@/i18n';
import { getLocale, locales, type Locale } from '@/paraglide/runtime';
import { useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
    Paintbrush,
    Image as ImageIcon,
    LayoutPanelTop,
    Zap,
    Languages,
    SlidersHorizontal,
    Check,
    Monitor,
    Moon,
    Terminal,
    Info,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { cn } from '@/lib/cn';
import { updateGeneralSettings, updateModeSettings, type PanelMode } from '@/api/adminSettings';

// Render a locale code as its own autonym (e.g. "de" -> "Deutsch"), with the
// English name as a secondary label for admins who don't read the script.
function localeLabel(code: string): { native: string; english: string } {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    try {
        const native = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        const english = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
        return { native: cap(native ?? code), english: cap(english ?? code) };
    } catch {
        return { native: code.toUpperCase(), english: code.toUpperCase() };
    }
}

function SectionCard({ icon: Icon, title, subtitle, children }: {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    children: ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)]/12 text-[var(--brand)]">
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
                    <p className="text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

interface GeneralForm {
    name: string;
    logo: string;
    locale: string;
    indicators: boolean;
    speedDial: boolean;
}

export default function SettingsSection() {
    const push = useFlashes(s => s.push);
    const site = window.SiteConfiguration;

    const initial: GeneralForm = {
        name: site?.name ?? '',
        logo: site?.logo ?? '',
        locale: site?.locale ?? getLocale(),
        indicators: site?.indicators ?? false,
        speedDial: site?.speed_dial ?? false,
    };

    const [form, setForm] = useState<GeneralForm>(initial);
    const [saved, setSaved] = useState<GeneralForm>(initial);
    const [saving, setSaving] = useState(false);

    const nameInvalid = form.name.trim().length < 3;
    const dirty = useMemo(
        () => (Object.keys(form) as (keyof GeneralForm)[]).some(k => form[k] !== saved[k]),
        [form, saved],
    );

    const set = <K extends keyof GeneralForm>(key: K, value: GeneralForm[K]) =>
        setForm(f => ({ ...f, [key]: value }));

    const handleSave = async () => {
        if (nameInvalid || saving) return;
        setSaving(true);
        const localeChanged = form.locale !== saved.locale;
        try {
            await updateGeneralSettings({
                name: form.name.trim(),
                logo: form.logo.trim() || null,
                locale: form.locale,
                indicators: form.indicators,
                speed_dial: form.speedDial,
            });
            // The default language is a GLOBAL setting (app:locale) — now saved
            // for every user's next load. Mirror it onto the in-memory
            // SiteConfiguration so a re-render reads the new default, then switch
            // this session's locale live (re-renders the app, no page reload).
            if (window.SiteConfiguration) window.SiteConfiguration.locale = form.locale;
            setSaved(form);
            push({ type: 'success', message: m['admin.settings.saved']() });
            if (localeChanged) setLocale(form.locale as Locale);
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['admin.settings.saveError']() });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                    {m['admin.settings.title']()}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                    {m['admin.settings.subtitle']({ name: saved.name || 'M12Labs' })}
                </p>
            </header>

            <SectionCard
                icon={Paintbrush}
                title={m['admin.settings.general.title']()}
                subtitle={m['admin.settings.general.subtitle']()}
            >
                <div className="grid gap-5 md:grid-cols-2">
                    <Field label={m['admin.settings.general.name']()} htmlFor="app-name" error={nameInvalid && form.name.length > 0 ? m['admin.settings.general.nameHelp']() : undefined}>
                        <Input
                            id="app-name"
                            value={form.name}
                            invalid={nameInvalid && form.name.length > 0}
                            placeholder={m['admin.settings.general.namePlaceholder']()}
                            maxLength={40}
                            onChange={e => set('name', e.target.value)}
                        />
                        <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.settings.general.nameHelp']()}</p>
                    </Field>
                    <Field label={m['admin.settings.general.logo']()} htmlFor="app-logo">
                        <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]">
                                {form.logo.trim() ? (
                                    <img src={form.logo} alt="" className="h-full w-full object-contain" onError={e => (e.currentTarget.style.visibility = 'hidden')} />
                                ) : (
                                    <ImageIcon className="h-4 w-4 text-[var(--color-ink-faint)]" />
                                )}
                            </span>
                            <Input
                                id="app-logo"
                                type="url"
                                value={form.logo}
                                placeholder={m['admin.settings.general.logoPlaceholder']()}
                                maxLength={255}
                                onChange={e => set('logo', e.target.value)}
                            />
                        </div>
                        <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.settings.general.logoHelp']()}</p>
                    </Field>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <ToggleRow
                        icon={LayoutPanelTop}
                        label={m['admin.settings.general.indicators']()}
                        help={m['admin.settings.general.indicatorsHelp']()}
                        checked={form.indicators}
                        onChange={v => set('indicators', v)}
                    />
                    <ToggleRow
                        icon={Zap}
                        label={m['admin.settings.general.speedDial']()}
                        help={m['admin.settings.general.speedDialHelp']()}
                        checked={form.speedDial}
                        onChange={v => set('speedDial', v)}
                    />
                </div>
            </SectionCard>

            <SectionCard
                icon={Languages}
                title={m['admin.settings.language.title']()}
                subtitle={m['admin.settings.language.subtitle']()}
            >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {locales.map(code => {
                        const { native, english } = localeLabel(code);
                        const selected = form.locale === code;
                        const isDefault = saved.locale === code;
                        return (
                            <button
                                key={code}
                                type="button"
                                onClick={() => set('locale', code)}
                                className={cn(
                                    'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                                    selected
                                        ? 'border-[var(--brand)] bg-[var(--brand)]/8'
                                        : 'border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]',
                                )}
                            >
                                <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-2)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                                    {code}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-[var(--color-ink)]">{native}</span>
                                    {english !== native && (
                                        <span className="block truncate text-xs text-[var(--color-ink-faint)]">{english}</span>
                                    )}
                                </span>
                                {isDefault && (
                                    <span className="shrink-0 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                                        {m['admin.settings.language.current']()}
                                    </span>
                                )}
                                {selected && !isDefault && <Check className="h-4 w-4 shrink-0 text-[var(--brand)]" />}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-3 text-xs text-[var(--color-ink-faint)]">{m['admin.settings.language.help']()}</p>
            </SectionCard>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.settings.refreshNote']()}</p>
                <Button disabled={!dirty || nameInvalid || saving} onClick={handleSave}>
                    {saving ? <Spinner className="h-4 w-4" /> : m['admin.settings.save']()}
                </Button>
            </div>

            <ModeSection initialMode={(site?.mode as PanelMode) ?? 'standard'} debug={site?.debug ?? false} />
        </div>
    );
}

function ToggleRow({ icon: Icon, label, help, checked, onChange }: {
    icon: LucideIcon;
    label: string;
    help: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border-strong)] p-3.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-ink)]">{label}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{help}</span>
            </span>
            <Switch checked={checked} onChange={onChange} className="mt-0.5" />
        </label>
    );
}

function ModeSection({ initialMode, debug }: { initialMode: PanelMode; debug: boolean }) {
    const push = useFlashes(s => s.push);
    const [mode, setMode] = useState<PanelMode>(initialMode);
    const [busy, setBusy] = useState<PanelMode | null>(null);
    const [debugOpen, setDebugOpen] = useState(false);

    const apply = async (next: PanelMode) => {
        if (next === mode || busy) return;
        setBusy(next);
        try {
            await updateModeSettings(next);
            setMode(next);
            push({ type: 'success', message: m['admin.settings.mode.saved']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['admin.settings.saveError']() });
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <SectionCard
                icon={SlidersHorizontal}
                title={m['admin.settings.mode.title']()}
                subtitle={m['admin.settings.mode.subtitle']()}
            >
                <div className="grid gap-3 lg:grid-cols-3">
                    <ModeCard
                        icon={Monitor}
                        title={m['admin.settings.mode.standard']()}
                        desc={m['admin.settings.mode.standardDesc']()}
                        active={mode === 'standard'}
                        busy={busy === 'standard'}
                        onSelect={() => apply('standard')}
                    />
                    <ModeCard
                        icon={Moon}
                        title={m['admin.settings.mode.personal']()}
                        desc={m['admin.settings.mode.personalDesc']()}
                        active={mode === 'personal'}
                        busy={busy === 'personal'}
                        onSelect={() => apply('personal')}
                    />
                    <ModeCard
                        icon={Terminal}
                        title={m['admin.settings.mode.debug']()}
                        desc={m['admin.settings.mode.debugDesc']()}
                        active={debug}
                        activeLabel={m['admin.settings.mode.envManaged']()}
                        onSelect={() => setDebugOpen(true)}
                    />
                </div>
            </SectionCard>

            <Modal open={debugOpen} onClose={() => setDebugOpen(false)} title={m['admin.settings.mode.debugDialogTitle']()} size="sm">
                <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.settings.mode.debugDialogIntro']()}</p>
                <ol className="mt-3 space-y-2 text-sm text-[var(--color-ink)]">
                    {[
                        m['admin.settings.mode.debugStep1'](),
                        m['admin.settings.mode.debugStep2'](),
                        m['admin.settings.mode.debugStep3'](),
                        m['admin.settings.mode.debugStep4'](),
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
        </>
    );
}

function ModeCard({ icon: Icon, title, desc, active, busy, activeLabel, onSelect }: {
    icon: LucideIcon;
    title: string;
    desc: string;
    active: boolean;
    busy?: boolean;
    activeLabel?: string;
    onSelect: () => void;
}) {
    return (
        <div
            className={cn(
                'flex flex-col rounded-xl border p-4 transition-colors',
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
            <div className="mt-4">
                {active ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
                        <Check className="h-3.5 w-3.5" />
                        {activeLabel ?? m['admin.settings.mode.active']()}
                    </span>
                ) : activeLabel !== undefined ? (
                    <Button variant="outline" size="sm" onClick={onSelect}>
                        <Info className="h-3.5 w-3.5" />
                        {m['admin.settings.mode.enable']()}
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" disabled={busy} onClick={onSelect}>
                        {busy ? <Spinner className="h-4 w-4" /> : m['admin.settings.mode.enable']()}
                    </Button>
                )}
            </div>
        </div>
    );
}
