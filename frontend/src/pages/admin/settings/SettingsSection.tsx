import { m } from '@/i18n';
import { getLocale, locales } from '@/paraglide/runtime';
import { useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
    Paintbrush,
    Image as ImageIcon,
    LayoutPanelTop,
    Zap,
    Languages,
    UserRound,
    Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { stashFlash } from '@/lib/pendingFlash';
import { cn } from '@/lib/cn';
import { updateGeneralSettings } from '@/api/adminSettings';

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
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]">
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
    userLocale: boolean;
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
        userLocale: site?.user_locale ?? true,
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
                user_locale: form.userLocale,
                indicators: form.indicators,
                speed_dial: form.speedDial,
            });
            // The default language is a GLOBAL setting (app:locale) — now saved
            // for every user's next load. Mirror it onto the in-memory
            // SiteConfiguration so a re-render reads the new default.
            if (window.SiteConfiguration) {
                window.SiteConfiguration.locale = form.locale;
                window.SiteConfiguration.user_locale = form.userLocale;
            }
            setSaved(form);
            if (localeChanged) {
                // Reboot Paraglide in the new default via a reload rather than a
                // live router remount, which races Radix portal teardown
                // ("removeChild" crash). The flash is stashed so it survives.
                stashFlash({ type: 'success', message: m['admin.settings.saved']() });
                window.location.reload();
                return;
            }
            push({ type: 'success', message: m['admin.settings.saved']() });
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
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]">
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
                                    'flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
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

                <div className="mt-4">
                    <ToggleRow
                        icon={UserRound}
                        label={m['admin.settings.language.userLocale']()}
                        help={m['admin.settings.language.userLocaleHelp']()}
                        checked={form.userLocale}
                        onChange={v => set('userLocale', v)}
                    />
                </div>
            </SectionCard>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.settings.refreshNote']()}</p>
                <Button disabled={!dirty || nameInvalid || saving} onClick={handleSave}>
                    {saving ? <Spinner className="h-4 w-4" /> : m['common.actions.saveChanges']()}
                </Button>
            </div>
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
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border-strong)] p-3.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-ink)]">{label}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{help}</span>
            </span>
            <Switch checked={checked} onChange={onChange} className="mt-0.5" />
        </label>
    );
}
