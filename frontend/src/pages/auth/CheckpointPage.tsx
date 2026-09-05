import { m } from '@/i18n/messages';
import { abs } from '@/lib/base';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { checkpoint, getPendingCheckpoint } from '@/api/auth';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

const CODE_LENGTH = 6;

/**
 * Second login factor.
 *
 * The confirmation token arrives one of two ways: in router state, when the
 * password login navigated here, or from the session over
 * `GET /auth/login/checkpoint/pending`, when an SSO callback redirected in. It
 * is deliberately never in the URL.
 */
export default function CheckpointPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const stateToken = (location.state as { confirmationToken?: string } | null)?.confirmationToken;

    const [confirmationToken, setConfirmationToken] = useState<string | null>(stateToken ?? null);
    const [resolving, setResolving] = useState(!stateToken);
    const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
    const [code, setCode] = useState('');
    const [recovery, setRecovery] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const codeRef = useRef<HTMLInputElement>(null);

    // No router state means we arrived via a server redirect (SSO). Ask the
    // backend whether this session has a login waiting on a second factor.
    useEffect(() => {
        if (stateToken) return;
        let active = true;
        getPendingCheckpoint()
            .then(token => {
                if (!active) return;
                setConfirmationToken(token);
                setResolving(false);
            })
            .catch(() => active && setResolving(false));
        return () => {
            active = false;
        };
    }, [stateToken]);

    useEffect(() => {
        if (mode === 'totp' && confirmationToken) codeRef.current?.focus();
    }, [mode, confirmationToken]);

    const submit = async (value: string) => {
        if (!confirmationToken || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await checkpoint({
                confirmationToken,
                code: mode === 'totp' ? value : undefined,
                recoveryToken: mode === 'recovery' ? value : undefined,
            });
            window.location.assign(res.intended || abs());
        } catch (err) {
            setSubmitting(false);
            setCode('');
            setError(
                firstError(err) ??
                    (mode === 'recovery' ? m['auth.checkpoint.recoveryError']() : m['auth.checkpoint.codeError']()),
            );
            if (mode === 'totp') codeRef.current?.focus();
        }
    };

    // Auto-submit the moment six digits are present — an authenticator code is a
    // fixed length, so making the user reach for a button adds nothing.
    const onCodeChange = (raw: string) => {
        const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
        setCode(digits);
        if (digits.length === CODE_LENGTH) void submit(digits);
    };

    if (resolving) {
        return (
            <div className="flex w-full items-center justify-center py-8">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    if (!confirmationToken) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.checkpoint.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {m['auth.checkpoint.missingToken']()}
                    </p>
                </div>
                <Button size="lg" onClick={() => navigate('/auth/login')}>
                    {m['auth.backToLogin']()}
                </Button>
            </div>
        );
    }

    return (
        <form
            onSubmit={e => {
                e.preventDefault();
                void submit(mode === 'totp' ? code : recovery);
            }}
            className="flex w-full flex-col gap-5"
        >
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.checkpoint.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                    {mode === 'totp' ? m['auth.checkpoint.subtitle']() : m['auth.checkpoint.recoverySubtitle']()}
                </p>
            </div>

            {error && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {error}
                </div>
            )}

            {mode === 'totp' ? (
                <Field label={m['auth.checkpoint.codeLabel']()} htmlFor="code">
                    <Input
                        id="code"
                        ref={codeRef}
                        value={code}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={CODE_LENGTH}
                        placeholder="000000"
                        disabled={submitting}
                        onChange={e => onCodeChange(e.target.value)}
                        className="text-center font-mono text-2xl tracking-[0.5em]"
                    />
                </Field>
            ) : (
                <Field label={m['auth.checkpoint.recoveryLabel']()} htmlFor="recovery">
                    <Input
                        id="recovery"
                        value={recovery}
                        autoComplete="one-time-code"
                        disabled={submitting}
                        onChange={e => setRecovery(e.target.value)}
                    />
                </Field>
            )}

            <Button
                type="submit"
                size="lg"
                disabled={submitting || (mode === 'totp' ? code.length !== CODE_LENGTH : recovery.trim().length === 0)}
            >
                {submitting && <Spinner className="h-4 w-4" />}
                {submitting ? m['auth.checkpoint.submitting']() : m['auth.checkpoint.submit']()}
            </Button>

            {/* One method at a time: the backend takes the recovery branch whenever
                a recovery token is present, so offering both fields at once meant a
                correct TOTP code could be rejected alongside a stray recovery entry. */}
            <button
                type="button"
                onClick={() => {
                    setMode(mode === 'totp' ? 'recovery' : 'totp');
                    setError(null);
                    setCode('');
                    setRecovery('');
                }}
                className="inline-flex items-center justify-center gap-2 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
                {mode === 'totp' ? (
                    <>
                        <KeyRound className="h-3.5 w-3.5" />
                        {m['auth.checkpoint.useRecovery']()}
                    </>
                ) : (
                    <>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {m['auth.checkpoint.useCode']()}
                    </>
                )}
            </button>
        </form>
    );
}
