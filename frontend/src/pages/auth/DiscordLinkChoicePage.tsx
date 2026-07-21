import { m } from '@/i18n';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Link2, ArrowRight } from 'lucide-react';
import { getDiscordRegistrationData, type DiscordRegistrationData } from '@/api/authDiscord';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

// Shown after a Discord OAuth callback that matched no existing account. The
// user either creates a fresh panel account bound to the Discord profile, or
// links Discord to an account they already own (done from Account settings).
export default function DiscordLinkChoicePage() {
    const navigate = useNavigate();
    const [data, setData] = useState<DiscordRegistrationData | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        getDiscordRegistrationData()
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
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.discord.errorTitle']()}</h1>
                <p className="text-sm text-[var(--color-danger)]">{m['auth.discord.linkNotFound']()}</p>
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

    return (
        <div className="flex w-full flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.discord.linkTitle']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.discord.linkSubtitle']()}</p>
            </div>

            <div className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/8 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
                    {m['auth.discord.accountLabel']()}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                        <dt className="text-[var(--color-ink-faint)]">{m['auth.discord.username']()}</dt>
                        <dd className="truncate text-[var(--color-ink)]">{data.discord_username}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-[var(--color-ink-faint)]">{m['auth.discord.email']()}</dt>
                        <dd className="truncate text-[var(--color-ink)]">{data.discord_email}</dd>
                    </div>
                </dl>
            </div>

            <div className="flex flex-col gap-3">
                <button
                    type="button"
                    onClick={() => navigate('/auth/discord/register')}
                    className="group flex items-start gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand)]/8"
                >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                        <UserPlus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--color-ink)]">
                            {m['auth.discord.createTitle']()}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                            {m['auth.discord.createBody']()}
                        </span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-ink-faint)] transition-colors group-hover:text-[var(--brand)]" />
                </button>

                <div className="rounded-lg border border-[var(--color-border-strong)] p-4">
                    <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                            <Link2 className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[var(--color-ink)]">
                                {m['auth.discord.linkExistingTitle']()}
                            </p>
                            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                                {m['auth.discord.linkExistingBody']()}
                            </p>
                            <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-[var(--color-ink-faint)]">
                                <li>{m['auth.discord.linkStep1']()}</li>
                                <li>{m['auth.discord.linkStep2']()}</li>
                                <li>{m['auth.discord.linkStep3']()}</li>
                            </ol>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => navigate('/auth/login')}
                    >
                        {m['auth.discord.goToLogin']()}
                    </Button>
                </div>
            </div>

            <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
                {m['common.actions.cancel']()}
            </button>
        </div>
    );
}
