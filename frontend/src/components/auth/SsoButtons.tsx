import { m } from '@/i18n';
import { useState } from 'react';
import { externalLogin } from '@/api/auth';
import { firstError } from '@/lib/apiError';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { DiscordIcon, GoogleIcon } from './ProviderIcons';

type Provider = 'discord' | 'google';

/**
 * SSO entry points for the login and register pages.
 *
 * A provider is only offered when the admin has enabled it *and* both OAuth
 * credentials are set — an enabled-but-unconfigured module would otherwise
 * render a button that can only ever fail.
 */
export function SsoButtons({
    captchaToken,
    onError,
}: {
    /** Turnstile response, when the captcha is enabled. Buttons stay disabled until it arrives. */
    captchaToken?: string;
    onError: (message: string) => void;
}) {
    const modules = useFlags(s => s.everest?.auth?.modules);
    const captcha = useFlags(s => s.site?.captcha);
    const [busy, setBusy] = useState<Provider | null>(null);

    const usable = (provider: Provider) => {
        const mod = modules?.[provider] as { enabled?: boolean; clientId?: boolean; clientSecret?: boolean } | undefined;
        return Boolean(mod?.enabled && mod.clientId && mod.clientSecret);
    };

    const providers = (['discord', 'google'] as const).filter(usable);
    if (providers.length === 0) return null;

    const captchaPending = Boolean(captcha?.enabled && captcha.siteKey && !captchaToken);

    const start = async (provider: Provider) => {
        setBusy(provider);
        try {
            const url = await externalLogin(provider, captchaToken);
            if (!url) throw new Error('empty redirect');
            // Full navigation off-site to the provider's consent screen.
            window.location.assign(url);
        } catch (err) {
            setBusy(null);
            onError(firstError(err) ?? m['auth.sso.startFailed']());
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                    {m['auth.sso.divider']()}
                </span>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                {providers.map(provider => (
                    <Button
                        key={provider}
                        type="button"
                        variant="outline"
                        onClick={() => start(provider)}
                        disabled={busy !== null || captchaPending}
                        title={captchaPending ? m['auth.sso.captchaFirst']() : undefined}
                        className={providers.length === 1 ? 'sm:col-span-2' : undefined}
                    >
                        {busy === provider ? (
                            <Spinner className="h-4 w-4" />
                        ) : provider === 'discord' ? (
                            <DiscordIcon className="h-4 w-4 text-[#5865F2]" />
                        ) : (
                            <GoogleIcon className="h-4 w-4" />
                        )}
                        {provider === 'discord' ? m['auth.sso.discord']() : m['auth.sso.google']()}
                    </Button>
                ))}
            </div>
        </div>
    );
}
