import { m } from '@/i18n/messages';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Check } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
    getLinkedSsoAccounts,
    getSsoLinkUrl,
    unlinkSsoProvider,
    type LinkedSsoAccount,
    type SsoProvider,
} from '@/api/account';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { DiscordIcon, GoogleIcon } from '@/components/auth/ProviderIcons';
import { SettingsRow } from './SettingsRow';

/**
 * Connected accounts. Replaces the Discord-only row now that Google links the
 * same way — both are rows in `user_oauth_accounts`, so one list covers them.
 */
export function LinkedAccountsRow() {
    const push = useFlashes(s => s.push);
    const queryClient = useQueryClient();
    const [confirming, setConfirming] = useState<SsoProvider | null>(null);
    const [password, setPassword] = useState('');
    const [unlinkError, setUnlinkError] = useState<string | null>(null);
    const [params, setParams] = useSearchParams();

    const { data: accounts, isLoading } = useQuery({
        queryKey: ['account', 'sso'],
        queryFn: getLinkedSsoAccounts,
    });

    // The link callback is a server redirect back to /settings, so its outcome
    // arrives in the query string. Consume it so a refresh does not re-toast.
    useEffect(() => {
        const linked = params.get('sso_linked');
        const error = params.get('sso_error');
        if (!linked && !error) return;

        if (linked) {
            push({ type: 'success', message: m['account.sso.linkSuccess']() });
            void queryClient.invalidateQueries({ queryKey: ['account', 'sso'] });
        } else if (error === 'already_linked') {
            push({ type: 'error', message: m['account.sso.alreadyLinked']() });
        } else {
            push({ type: 'error', message: m['account.sso.linkFailed']() });
        }

        const next = new URLSearchParams(params);
        next.delete('sso_linked');
        next.delete('sso_error');
        setParams(next, { replace: true });
    }, [params, setParams, push, queryClient]);

    const link = useMutation({
        mutationFn: getSsoLinkUrl,
        onSuccess: url => {
            window.location.href = url;
        },
        onError: (err: unknown) =>
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const unlink = useMutation({
        mutationFn: (provider: SsoProvider) => unlinkSsoProvider(provider, password),
        onSuccess: () => {
            closeUnlink();
            void queryClient.invalidateQueries({ queryKey: ['account', 'sso'] });
            push({ type: 'success', message: m['account.sso.unlinkSuccess']() });
        },
        // Kept in the dialog rather than flashed away, so a mistyped password can
        // be corrected without reopening it.
        onError: (err: unknown) => setUnlinkError(firstError(err) ?? m['common.states.genericError']()),
    });

    const closeUnlink = () => {
        setConfirming(null);
        setPassword('');
        setUnlinkError(null);
    };

    // Only providers an admin has switched on are worth showing.
    const available = (accounts ?? []).filter(a => a.enabled);
    if (!isLoading && available.length === 0) return null;

    const linkedCount = available.filter(a => a.linked).length;

    const badge =
        linkedCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
                <Check className="h-3.5 w-3.5" />
                {m['account.sso.linkedCount']({ count: String(linkedCount) })}
            </span>
        ) : (
            <span className="text-xs text-[var(--color-ink-faint)]">{m['account.sso.noneLinked']()}</span>
        );

    const target = available.find(a => a.provider === confirming);

    return (
        <SettingsRow
            icon={Link2}
            title={m['account.sso.title']()}
            description={m['account.sso.description']()}
            badge={badge}
        >
            {/* SettingsRow lays its children out inside a flex-wrap row, so the
                provider list needs full width to sit on its own line. */}
            {isLoading ? (
                <div className="flex w-full justify-center py-4">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : (
                <div className="mt-3 flex w-full flex-col gap-2">
                    {available.map(account => (
                        <ProviderLine
                            key={account.provider}
                            account={account}
                            busy={link.isPending || unlink.isPending}
                            onLink={() => link.mutate(account.provider)}
                            onUnlink={() => setConfirming(account.provider)}
                        />
                    ))}
                </div>
            )}

            <Modal
                open={confirming !== null}
                onClose={closeUnlink}
                title={m['account.sso.unlinkConfirmTitle']({ provider: target?.label ?? '' })}
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={closeUnlink} disabled={unlink.isPending}>
                            {m['common.actions.cancel']()}
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => confirming && password && unlink.mutate(confirming)}
                            disabled={!password || unlink.isPending}
                        >
                            {unlink.isPending && <Spinner className="h-4 w-4" />}
                            {m['account.sso.unlinkConfirm']()}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-[var(--color-ink-muted)]">
                        {m['account.sso.unlinkConfirmBody']({ provider: target?.label ?? '' })}
                    </p>

                    {unlinkError && (
                        <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                            {unlinkError}
                        </div>
                    )}

                    <Field label={m['account.sso.unlinkPassword']()} htmlFor="sso-unlink-password">
                        <Input
                            id="sso-unlink-password"
                            type="password"
                            autoFocus
                            autoComplete="current-password"
                            value={password}
                            invalid={!!unlinkError}
                            disabled={unlink.isPending}
                            onChange={e => {
                                setPassword(e.target.value);
                                setUnlinkError(null);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && confirming && password && !unlink.isPending) {
                                    unlink.mutate(confirming);
                                }
                            }}
                        />
                    </Field>
                </div>
            </Modal>
        </SettingsRow>
    );
}

function ProviderLine({
    account,
    busy,
    onLink,
    onUnlink,
}: {
    account: LinkedSsoAccount;
    busy: boolean;
    onLink: () => void;
    onUnlink: () => void;
}) {
    const Icon = account.provider === 'discord' ? DiscordIcon : GoogleIcon;

    return (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
            <Icon className={account.provider === 'discord' ? 'h-4 w-4 text-[#5865F2]' : 'h-4 w-4'} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-ink)]">{account.label}</p>
                <p className="truncate text-xs text-[var(--color-ink-faint)]">
                    {account.linked
                        ? (account.username ?? account.email ?? m['account.sso.linked']())
                        : m['account.sso.notLinked']()}
                </p>
            </div>
            {account.linked ? (
                <Button variant="outline" size="sm" onClick={onUnlink} disabled={busy}>
                    {m['account.sso.unlink']()}
                </Button>
            ) : (
                <Button size="sm" onClick={onLink} disabled={busy}>
                    {m['account.sso.link']()}
                </Button>
            )}
        </div>
    );
}
