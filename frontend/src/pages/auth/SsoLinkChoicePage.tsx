import { m } from '@/i18n/messages';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Link2, ArrowRight } from 'lucide-react';
import {
    getSsoRegistrationData,
    startSsoLinkIntent,
    cancelSsoFlow,
    type SsoRegistrationData,
} from '@/api/authSso';
import { firstError } from '@/lib/apiError';
import { Spinner } from '@/components/ui/Spinner';
import { DiscordIcon, GoogleIcon } from '@/components/auth/ProviderIcons';

/**
 * Shown after an OAuth callback that matched no existing account. The user
 * either creates a fresh panel account bound to the provider identity, or signs
 * into an account they already own so the identity is attached to it.
 *
 * When the provider's email already belongs to an account, linking leads —
 * creating a second account with that address is not possible anyway.
 */
export default function SsoLinkChoicePage() {
    const navigate = useNavigate();
    const [data, setData] = useState<SsoRegistrationData | null>(null);
    const [error, setError] = useState(false);
    const [linking, setLinking] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        getSsoRegistrationData()
            .then(d => active && setData(d))
            .catch(() => {
                if (!active) return;
                setError(true);
                setTimeout(() => navigate('/auth/login'), 2000);
            });
        return () => {
            active = false;
        };
    }, [navigate]);

    if (error) {
        return (
            <div className="flex w-full flex-col gap-3 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.sso.errorTitle']()}</h1>
                <p className="text-sm text-[var(--color-danger)]">{m['auth.sso.sessionNotFound']()}</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex w-full items-center justify-center py-8">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const Icon = data.provider === 'discord' ? DiscordIcon : GoogleIcon;

    // Signing in to link: record the intent, then send them to the login form.
    // The backend attaches the identity once the password (and 2FA) check passes.
    const onLink = async () => {
        setLinking(true);
        setLinkError(null);
        try {
            await startSsoLinkIntent();
            navigate('/auth/login');
        } catch (err) {
            setLinking(false);
            setLinkError(firstError(err) ?? m['common.states.genericError']());
        }
    };

    const canCreate = !data.email_taken;

    const createCard = (
        <button
            type="button"
            onClick={() => navigate('/auth/sso/register')}
            className="group flex items-start gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand)]/8"
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                <UserPlus className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-ink)]">
                    {m['auth.sso.createTitle']()}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                    {m['auth.sso.createBody']({ provider: data.provider_label })}
                </span>
            </span>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-ink-faint)] transition-colors group-hover:text-[var(--brand)]" />
        </button>
    );

    const linkCard = (
        <button
            type="button"
            onClick={onLink}
            disabled={linking}
            className="group flex items-start gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand)]/8 disabled:opacity-60"
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                {linking ? <Spinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-ink)]">
                    {m['auth.sso.linkExistingTitle']()}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                    {data.email_taken
                        ? m['auth.sso.linkExistingTaken']({ provider: data.provider_label })
                        : m['auth.sso.linkExistingBody']({ provider: data.provider_label })}
                </span>
            </span>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-ink-faint)] transition-colors group-hover:text-[var(--brand)]" />
        </button>
    );

    return (
        <div className="flex w-full flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                    {m['auth.sso.linkTitle']({ provider: data.provider_label })}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.sso.linkSubtitle']()}</p>
            </div>

            <div className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/8 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
                    <Icon className="h-3.5 w-3.5" />
                    {m['auth.sso.accountLabel']({ provider: data.provider_label })}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                    {data.username && (
                        <div className="flex justify-between gap-3">
                            <dt className="text-[var(--color-ink-faint)]">{m['auth.sso.username']()}</dt>
                            <dd className="truncate text-[var(--color-ink)]">{data.username}</dd>
                        </div>
                    )}
                    <div className="flex justify-between gap-3">
                        <dt className="text-[var(--color-ink-faint)]">{m['auth.sso.email']()}</dt>
                        <dd className="truncate text-[var(--color-ink)]">{data.email ?? '—'}</dd>
                    </div>
                </dl>
            </div>

            {linkError && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {linkError}
                </div>
            )}

            {/* An account already using this address can only be linked, never
                duplicated — so that option leads when the email is taken. */}
            <div className="flex flex-col gap-3">
                {canCreate ? (
                    <>
                        {createCard}
                        {linkCard}
                    </>
                ) : (
                    <>
                        {linkCard}
                        <p className="text-xs text-[var(--color-ink-faint)]">
                            {m['auth.sso.emailTakenNote']({ email: data.email ?? '' })}
                        </p>
                    </>
                )}
            </div>

            <button
                type="button"
                onClick={async () => {
                    await cancelSsoFlow();
                    navigate('/auth/login');
                }}
                className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
                {m['common.actions.cancel']()}
            </button>
        </div>
    );
}
