import { m } from '@/i18n';
import { BadgeCheck, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { SettingsCard } from './SettingsCard';
import { EmailForm } from './EmailForm';
import { PasswordForm } from './PasswordForm';
import { TwoFactorRow } from './TwoFactorRow';
import { RecoveryCodeRow } from './RecoveryCodeRow';
import { LinkedAccountsRow } from './LinkedAccountsRow';
import { BillingAddressRow } from './BillingAddressRow';
import { LanguageCard } from './LanguageCard';

// "Account" tab of the settings page: identity summary, the email and password
// forms, and a single "Sign-in & security" card of compact rows (2FA, recovery
// code, connected accounts, billing address).
export function AccountTab() {
    const user = useSession(s => s.user);
    const flags = useFlags(s => s.everest);

    // Either SSO module being on is enough — the row lists whichever are enabled.
    const ssoEnabled =
        (flags?.auth.modules.discord.enabled ?? false) || (flags?.auth.modules.google.enabled ?? false);
    const billingEnabled = flags?.billing.enabled ?? false;
    // Admins can disable per-user language selection (app:user_locale).
    const userLocaleAllowed = window.SiteConfiguration?.user_locale !== false;

    const memberSince = user?.created_at ? new Date(user.created_at).toLocaleDateString() : null;

    return (
        <div className="flex flex-col gap-6">
            {user && (
                <SettingsCard title={m['account.profile.title']()}>
                    <div className="flex items-center gap-4">
                        <img
                            src={user.avatar_url}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-full border border-[var(--color-border)] object-cover"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-base font-semibold text-[var(--color-ink)]">
                                    {user.username}
                                </span>
                                {user.root_admin && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                                        {m['account.profile.admin']()}
                                    </span>
                                )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-ink-muted)]">
                                <span className="truncate">{user.email}</span>
                                {user.email_verified ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)]">
                                        <BadgeCheck className="h-3.5 w-3.5" />
                                        {m['account.profile.verified']()}
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-xs text-[var(--color-warning)]">
                                        <ShieldAlert className="h-3.5 w-3.5" />
                                        {m['account.profile.unverified']()}
                                    </span>
                                )}
                            </div>
                            {memberSince && (
                                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                                    {m['account.profile.memberSince']({ date: memberSince })}
                                </p>
                            )}
                        </div>
                    </div>
                </SettingsCard>
            )}

            <EmailForm />
            <PasswordForm />

            <SettingsCard
                title={m['account.security.title']()}
                description={m['account.security.description']()}
                icon={ShieldCheck}
                flush
            >
                <div className="divide-y divide-[var(--color-border)]">
                    <TwoFactorRow />
                    <RecoveryCodeRow />
                    {ssoEnabled && <LinkedAccountsRow />}
                    {billingEnabled && <BillingAddressRow />}
                </div>
            </SettingsCard>

            {userLocaleAllowed && <LanguageCard />}
        </div>
    );
}
