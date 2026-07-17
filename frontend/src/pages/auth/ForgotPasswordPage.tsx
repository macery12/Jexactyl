import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getPasswordResetMethod,
    requestPasswordResetEmail,
    resetPasswordWithRecoveryCode,
    type PasswordResetMethod,
} from '@/api/auth';
import { firstError } from '@/lib/apiError';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { Turnstile } from '@/components/auth/Turnstile';
import { PasswordInput, PasswordStrength, passwordMeetsPolicy } from '@/components/auth/PasswordStrength';

export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const captcha = useFlags(s => s.site?.captcha);
    const [token, setToken] = useState<string | undefined>(undefined);
    const [method, setMethod] = useState<PasswordResetMethod | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    // The backend decides the flow from its email-delivery config.
    useEffect(() => {
        getPasswordResetMethod()
            .then(setMethod)
            .catch(() => setMethod('email'));
    }, []);

    const onVerify = useCallback((t: string) => setToken(t), []);
    const captchaBlocking = Boolean(captcha?.enabled && captcha.siteKey && !token);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (method === 'email') {
            setSubmitting(true);
            try {
                await requestPasswordResetEmail({ email, captchaToken: token });
                setSent(true);
            } catch (err) {
                setError(firstError(err) ?? m['common.states.genericError']());
            } finally {
                setSubmitting(false);
            }
            return;
        }

        // recovery_code
        if (!passwordMeetsPolicy(password)) {
            setError(m['auth.register.passwordWeak']());
            return;
        }
        if (password !== confirm) {
            setError(m['auth.register.passwordMismatch']());
            return;
        }
        setSubmitting(true);
        try {
            const res = await resetPasswordWithRecoveryCode({ email, code, password, captchaToken: token });
            if (res.complete) {
                window.location.href = res.intended || abs();
                return;
            }
            // 2FA account — must sign in again.
            navigate('/auth/login');
        } catch (err) {
            setError(firstError(err) ?? m['common.states.genericError']());
        } finally {
            setSubmitting(false);
        }
    };

    if (method === null) return <FullPageSpinner />;

    if (sent) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.forgot.sentTitle']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.forgot.sentBody']()}</p>
                </div>
                <a
                    href={abs('/auth/login')}
                    className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                    {m['auth.backToLogin']()}
                </a>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.forgot.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                    {method === 'email' ? m['auth.forgot.subtitleEmail']() : m['auth.forgot.subtitleRecovery']()}
                </p>
            </div>

            {error && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {error}
                </div>
            )}

            <Field label={m['auth.forgot.emailLabel']()} htmlFor="email">
                <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                />
            </Field>

            {method === 'recovery_code' && (
                <>
                    <Field label={m['auth.recovery.codeLabel']()} htmlFor="code" hint={m['auth.recovery.codeHint']()}>
                        <Input id="code" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} />
                    </Field>

                    <Field label={m['auth.recovery.newPasswordLabel']()} htmlFor="password">
                        <PasswordInput
                            id="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                        />
                    </Field>
                    {password.length > 0 && <PasswordStrength value={password} />}

                    <Field label={m['auth.recovery.confirmLabel']()} htmlFor="confirm">
                        <PasswordInput
                            id="confirm"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                        />
                    </Field>
                </>
            )}

            {captcha?.enabled && captcha.siteKey && <Turnstile siteKey={captcha.siteKey} onVerify={onVerify} />}

            <Button type="submit" size="lg" disabled={submitting || captchaBlocking}>
                {submitting
                    ? m['common.states.saving']()
                    : method === 'email'
                      ? m['auth.forgot.submitEmail']()
                      : m['auth.forgot.submitRecovery']()}
            </Button>

            <a href={abs('/auth/login')} className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                {m['auth.backToLogin']()}
            </a>
        </form>
    );
}
