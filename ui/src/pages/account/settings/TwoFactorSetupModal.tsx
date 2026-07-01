import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, TriangleAlert } from 'lucide-react';
import { getTwoFactorSetup, enableTwoFactor } from '@/api/twoFactor';
import { firstError } from '@/lib/apiError';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

function groupSecret(secret: string): string {
    return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

function CopyButton({ text, label }: { text: string; label: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
            {label}
        </button>
    );
}

// Enrollment flow: scan/enter the secret and verify a code + password to enable
// 2FA, then present the one-time recovery tokens. `onEnabled` flips the account
// state as soon as the code verifies (before the tokens step).
export function TwoFactorSetupModal({
    open,
    onClose,
    onEnabled,
}: {
    open: boolean;
    onClose: () => void;
    onEnabled: () => void;
}) {
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [tokens, setTokens] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { data: setup, isLoading } = useQuery({
        queryKey: ['account', 'two-factor', 'setup'],
        queryFn: getTwoFactorSetup,
        enabled: open && tokens === null,
        staleTime: 0,
        gcTime: 0,
    });

    const enable = useMutation({
        mutationFn: () => enableTwoFactor(code, password),
        onSuccess: recovery => {
            setTokens(recovery);
            onEnabled();
        },
        onError: (err: unknown) => setError(firstError(err) ?? m['account.twoFactor.error']()),
    });

    const valid = code.trim().length === 6 && password.length > 0;

    // ---- Recovery tokens step ---------------------------------------------
    if (tokens) {
        return (
            <Modal
                open={open}
                onClose={onClose}
                title={m['account.twoFactor.recoveryTitle']()}
                footer={
                    <Button size="sm" onClick={onClose}>
                        {m['account.twoFactor.recoveryDone']()}
                    </Button>
                }
            >
                <div className="flex items-start gap-2 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2.5 text-sm text-[var(--color-ink)]">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                    <span>{m['account.twoFactor.recoveryWarning']()}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-4 font-mono text-sm text-[var(--color-ink)]">
                    {tokens.map(t => (
                        <span key={t} className="text-center">{t}</span>
                    ))}
                </div>
                <div className="mt-3 flex justify-end">
                    <CopyButton text={tokens.join('\n')} label={m['account.twoFactor.copyTokens']()} />
                </div>
            </Modal>
        );
    }

    // ---- Configure step ----------------------------------------------------
    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['account.twoFactor.setupTitle']()}
            description={m['account.twoFactor.setupDescription']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={enable.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => valid && enable.mutate()} disabled={!valid || enable.isPending || !setup}>
                        {enable.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.twoFactor.enable']()}
                    </Button>
                </>
            }
        >
            <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-xl bg-white p-3">
                {isLoading || !setup ? (
                    <Spinner className="h-6 w-6 text-[var(--color-ink-faint)]" />
                ) : (
                    <QRCodeSVG value={setup.imageUrlData} className="h-full w-full" />
                )}
            </div>

            {setup && (
                <div className="mt-3 flex flex-col items-center gap-1">
                    <p className="font-mono text-sm tracking-wide text-[var(--color-ink)]">{groupSecret(setup.secret)}</p>
                    <CopyButton text={setup.secret} label={m['account.twoFactor.copySecret']()} />
                </div>
            )}

            <p className="mt-5 text-sm text-[var(--color-ink-muted)]">{m['account.twoFactor.scanHint']()}</p>

            <div className="mt-4 flex flex-col gap-4">
                <Field label={m['account.twoFactor.code']()} htmlFor="tf-code">
                    <Input
                        id="tf-code"
                        value={code}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                </Field>
                <Field label={m['account.twoFactor.password']()} htmlFor="tf-password" error={error ?? undefined}>
                    <Input
                        id="tf-password"
                        type="password"
                        value={password}
                        invalid={!!error}
                        onChange={e => {
                            setPassword(e.target.value);
                            setError(null);
                        }}
                    />
                </Field>
            </div>
        </Modal>
    );
}
