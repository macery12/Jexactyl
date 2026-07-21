import { m, panelDefaultLocale } from '@/i18n';
import { locales, type Locale } from '@/paraglide/runtime';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { updateLanguage } from '@/api/account';
import { firstError } from '@/lib/apiError';
import { stashFlash } from '@/lib/pendingFlash';
import { useSession } from '@/state/session';
import { useFlashes } from '@/state/flashes';
import { Select, type SelectOption } from '@/components/ui/Select';
import { SettingsCard } from './SettingsCard';

// Radix Select forbids empty-string item values, so "follow the panel default"
// (language = null server-side) rides under a sentinel.
const PANEL_DEFAULT = 'default';

function isSupported(value: string | null | undefined): value is Locale {
    return !!value && (locales as readonly string[]).includes(value);
}

// Render a locale code as its own autonym (e.g. "de" -> "Deutsch"), matching
// the admin settings language grid.
function autonym(code: string): string {
    try {
        const native = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        return native ? native.charAt(0).toUpperCase() + native.slice(1) : code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

// Per-user language preference. Only rendered while admins allow overrides
// (SiteConfiguration.user_locale) — see AccountTab. Saving switches the UI
// live; the preference is stored on the account so it follows the user
// across browsers.
export function LanguageCard() {
    const user = useSession(s => s.user);
    const setUser = useSession(s => s.setUser);
    const push = useFlashes(s => s.push);

    const preferred = user?.language ?? null;
    const [value, setValue] = useState<string>(isSupported(preferred) ? preferred : PANEL_DEFAULT);

    const save = useMutation({
        mutationFn: (choice: string) => updateLanguage(choice === PANEL_DEFAULT ? null : choice),
        onSuccess: (_, choice) => {
            const language = choice === PANEL_DEFAULT ? null : choice;
            // Keep the in-memory contract in sync with the persisted preference so
            // the reboot resolves the right locale (resolveLocale reads
            // window.PterodactylUser.language).
            if (user) setUser({ ...user, language });
            if (window.PterodactylUser) window.PterodactylUser.language = language;
            // Reload to re-boot Paraglide in the new locale. Switching the whole
            // app live would remount the router tree from this callback and race
            // Radix's portal teardown ("removeChild" crash); a reload is the
            // robust path for a rare, app-wide change. The success flash is
            // stashed so it survives the reboot.
            stashFlash({ type: 'success', message: m['account.language.success']() });
            window.location.reload();
        },
        onError: (err: unknown) => {
            setValue(isSupported(preferred) ? preferred : PANEL_DEFAULT);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        },
    });

    const options: SelectOption[] = [
        { value: PANEL_DEFAULT, label: m['account.language.default']({ language: autonym(panelDefaultLocale()) }) },
        ...locales.map(code => ({ value: code, label: autonym(code) })),
    ];

    return (
        <SettingsCard
            title={m['account.language.title']()}
            description={m['account.language.description']()}
            icon={Languages}
        >
            <div className="max-w-xs">
                <Select
                    id="account-language"
                    value={value}
                    disabled={save.isPending}
                    options={options}
                    onChange={next => {
                        if (next === value) return;
                        setValue(next);
                        save.mutate(next);
                    }}
                />
            </div>
        </SettingsCard>
    );
}
