import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare, Check } from 'lucide-react';
import { getDiscordLinkUrl, unlinkDiscord } from '@/api/account';
import { firstError } from '@/lib/apiError';
import { useSession } from '@/state/session';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SettingsRow } from './SettingsRow';

export function DiscordRow() {
    const user = useSession(s => s.user);
    const setUser = useSession(s => s.setUser);
    const push = useFlashes(s => s.push);
    const [confirming, setConfirming] = useState(false);

    const linked = Boolean(user?.discord_linked);

    const link = useMutation({
        mutationFn: getDiscordLinkUrl,
        onSuccess: url => {
            window.location.href = url;
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const unlink = useMutation({
        mutationFn: unlinkDiscord,
        onSuccess: () => {
            if (user) setUser({ ...user, discord_linked: false });
            setConfirming(false);
            push({ type: 'success', message: m['account.discord.unlinkSuccess']() });
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const badge = linked ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
            <Check className="h-3.5 w-3.5" />
            {m['account.discord.linked']()}
        </span>
    ) : (
        <span className="text-xs text-[var(--color-ink-faint)]">{m['account.discord.notLinked']()}</span>
    );

    return (
        <SettingsRow
            icon={MessageSquare}
            title={m['account.discord.title']()}
            description={m['account.discord.description']()}
            badge={badge}
            action={
                linked ? (
                    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                        {m['account.discord.unlink']()}
                    </Button>
                ) : (
                    <Button size="sm" onClick={() => link.mutate()} disabled={link.isPending}>
                        {link.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.discord.link']()}
                    </Button>
                )
            }
        >
            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                title={m['account.discord.unlinkConfirmTitle']()}
                body={m['account.discord.unlinkConfirmBody']()}
                confirmLabel={m['account.discord.unlinkConfirm']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={unlink.isPending}
                onConfirm={() => unlink.mutate()}
            />
        </SettingsRow>
    );
}
