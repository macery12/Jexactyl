import { useState } from 'react';
import { Plus } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import {
    RegistrationCard,
    SecurityCard,
    CaptchaCard,
    OnboardingCard,
    JGuardCard,
    DiscordCard,
    GoogleCard,
} from './cards';
import { AddModuleModal } from './AddModuleModal';

// The authentication modules overview: core cards (registration / security /
// captcha) are always present; the optional modules render only when enabled.
// Reads the everest bootstrap the same way SettingsSection reads SiteConfiguration.
export default function AuthModulesPage() {
    const [adding, setAdding] = useState(false);
    const auth = window.EverestConfiguration?.auth;

    if (!auth) return null;

    const modules = auth.modules;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.auth.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.auth.subtitle']()}</p>
                </div>
                <Button size="sm" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" />
                    {m['admin.auth.addModule']()}
                </Button>
            </header>

            {/* Masonry columns: cards flow and pack by height so a tall card
                (e.g. Captcha with Turnstile expanded) never forces blank space
                into its row neighbours. */}
            <div className="gap-4 md:columns-2 xl:columns-3">
                {[
                    <RegistrationCard key="registration" auth={auth} />,
                    <SecurityCard key="security" auth={auth} />,
                    <CaptchaCard key="captcha" auth={auth} />,
                    modules.onboarding.enabled && <OnboardingCard key="onboarding" auth={auth} />,
                    modules.jguard.enabled && <JGuardCard key="jguard" />,
                    modules.discord.enabled && <DiscordCard key="discord" auth={auth} />,
                    modules.google.enabled && <GoogleCard key="google" auth={auth} />,
                ]
                    .filter(Boolean)
                    .map((card, i) => (
                        <div key={i} className="mb-4 break-inside-avoid">
                            {card}
                        </div>
                    ))}
            </div>

            <AddModuleModal open={adding} onClose={() => setAdding(false)} modules={modules} />
        </div>
    );
}
