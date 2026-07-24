import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { disableTwoFactor } from '@/api/twoFactor';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

const CODE_LENGTH = 6;

// Re-auth with the account password *and* the second factor to turn 2FA off —
// switching it off is what an attacker holding a stolen password or session
// would do first. `onDisabled` clears the account state on success.
export function DisableTwoFactorModal({
    open,
    onClose,
    onDisabled,
}: {
    open: boolean;
    onClose: () => void;
    onDisabled: () => void;
}) {
    const push = useFlashes(s => s.push);
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
    const [code, setCode] = useState('');
    const [recovery, setRecovery] = useState('');
    const [error, setError] = useState<string | null>(null);

    const secondFactor = mode === 'totp' ? code : recovery.trim();
    const ready = password.length > 0 && (mode === 'totp' ? code.length === CODE_LENGTH : secondFactor.length > 0);

    const disable = useMutation({
        mutationFn: () =>
            disableTwoFactor(password, {
                code: mode === 'totp' ? code : undefined,
                recoveryToken: mode === 'recovery' ? secondFactor : undefined,
            }),
        onSuccess: () => {
            onDisabled();
            push({ type: 'success', message: m['account.twoFactor.disableSuccess']() });
            reset();
            onClose();
        },
        onError: (err: unknown) => setError(firstError(err) ?? m['account.twoFactor.error']()),
    });

    const reset = () => {
        setPassword('');
        setCode('');
        setRecovery('');
        setMode('totp');
        setError(null);
    };

    const close = () => {
        reset();
        onClose();
    };

    const submit = () => {
        if (ready && !disable.isPending) disable.mutate();
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title={m['account.twoFactor.disableTitle']()}
            description={m['account.twoFactor.disableDescription']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={close} disabled={disable.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={submit}
                        disabled={!ready || disable.isPending}
                    >
                        {disable.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.twoFactor.disable']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {error && (
                    <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                        {error}
                    </div>
                )}

                <Field label={m['account.twoFactor.password']()} htmlFor="tf-disable-password">
                    <Input
                        id="tf-disable-password"
                        type="password"
                        autoFocus
                        autoComplete="current-password"
                        value={password}
                        invalid={!!error}
                        onChange={e => {
                            setPassword(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={e => e.key === 'Enter' && submit()}
                    />
                </Field>

                {mode === 'totp' ? (
                    <Field label={m['account.twoFactor.disableCodeLabel']()} htmlFor="tf-disable-code">
                        <Input
                            id="tf-disable-code"
                            value={code}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={CODE_LENGTH}
                            placeholder="000000"
                            invalid={!!error}
                            disabled={disable.isPending}
                            onChange={e => {
                                setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
                                setError(null);
                            }}
                            onKeyDown={e => e.key === 'Enter' && submit()}
                            className="text-center font-mono text-xl tracking-[0.4em]"
                        />
                    </Field>
                ) : (
                    <Field label={m['account.twoFactor.disableRecoveryLabel']()} htmlFor="tf-disable-recovery">
                        <Input
                            id="tf-disable-recovery"
                            value={recovery}
                            autoComplete="one-time-code"
                            invalid={!!error}
                            disabled={disable.isPending}
                            onChange={e => {
                                setRecovery(e.target.value);
                                setError(null);
                            }}
                            onKeyDown={e => e.key === 'Enter' && submit()}
                        />
                    </Field>
                )}

                {/* One method at a time, as on the login checkpoint: the backend
                    takes the recovery branch whenever a token is present, so
                    offering both fields at once would let a stray recovery entry
                    reject a correct code. */}
                <button
                    type="button"
                    onClick={() => {
                        setMode(mode === 'totp' ? 'recovery' : 'totp');
                        setCode('');
                        setRecovery('');
                        setError(null);
                    }}
                    className="inline-flex items-center gap-2 self-start text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                    {mode === 'totp' ? (
                        <>
                            <KeyRound className="h-3.5 w-3.5" />
                            {m['account.twoFactor.disableUseRecovery']()}
                        </>
                    ) : (
                        <>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {m['account.twoFactor.disableUseCode']()}
                        </>
                    )}
                </button>
            </div>
        </Modal>
    );
}
