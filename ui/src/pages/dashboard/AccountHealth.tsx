import { m } from '@/i18n';
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, MailCheck, MailWarning, ArrowUpRight } from 'lucide-react';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { cn } from '@/lib/cn';

function Row({
    ok,
    okIcon: OkIcon,
    badIcon: BadIcon,
    okLabel,
    badLabel,
    to,
}: {
    ok: boolean;
    okIcon: typeof ShieldCheck;
    badIcon: typeof ShieldAlert;
    okLabel: string;
    badLabel: string;
    to: string;
}) {
    const Icon = ok ? OkIcon : BadIcon;
    return (
        <Link
            to={to}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]"
        >
            <Icon className={cn('h-4 w-4 shrink-0', ok ? 'text-[var(--color-accent)]' : 'text-[var(--color-warning)]')} />
            <span className="flex-1 text-sm text-[var(--color-ink)]">{ok ? okLabel : badLabel}</span>
            {!ok && <ArrowUpRight className="h-4 w-4 text-[var(--color-ink-faint)]" />}
        </Link>
    );
}

export function AccountHealth() {
    const user = useSession(s => s.user);
    const emailEnabled = useFlags(s => s.everest)?.email.enabled ?? false;
    if (!user) return null;

    return (
        <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-muted)]">
                <ShieldCheck className="h-4 w-4" /> {m['dashboard.accountHealth']()}
            </h2>
            <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-2">
                <Row
                    ok={user.use_totp}
                    okIcon={ShieldCheck}
                    badIcon={ShieldAlert}
                    okLabel={m['dashboard.twoFactorEnabled']()}
                    badLabel={m['dashboard.enableTwoFactor']()}
                    to="/v2/account/settings"
                />
                {emailEnabled && (
                    <Row
                        ok={user.email_verified !== false}
                        okIcon={MailCheck}
                        badIcon={MailWarning}
                        okLabel={m['dashboard.emailVerified']()}
                        badLabel={m['dashboard.verifyEmail']()}
                        to="/v2/account/settings"
                    />
                )}
            </div>
        </section>
    );
}
