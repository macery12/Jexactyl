import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { resetPasswordWithToken } from '@/api/auth';
import { firstError } from '@/lib/apiError';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Input';
import { Turnstile } from '@/components/auth/Turnstile';
import { PasswordInput, PasswordStrength, passwordMeetsPolicy } from '@/components/auth/PasswordStrength';

export default function ResetPasswordPage() {
    const { token } = useParams<{ token: string }>();
    const [params] = useSearchParams();
    const email = params.get('email') ?? '';

    const captcha = useFlags(s => s.site?.captcha);
    const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const onVerify = useCallback((t: string) => setCaptchaToken(t), []);
    const missingLink = !token || !email;
    const captchaBlocking = Boolean(captcha?.enabled && captcha.siteKey && !captchaToken);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
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
            await resetPasswordWithToken({ email, token: token as string, password, captchaToken });
            setDone(true);
        } catch (err) {
            setError(firstError(err) ?? m['common.states.genericError']());
        } finally {
            setSubmitting(false);
        }
    };

    if (done) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.reset.doneTitle']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.reset.doneBody']()}</p>
                </div>
                <Button size="lg" onClick={() => (window.location.href = abs('/auth/login'))}>
                    {m['auth.reset.toLogin']()}
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.reset.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.reset.subtitle']()}</p>
            </div>

            {missingLink && (
                <div className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-warning)]">
                    {m['auth.reset.invalidLink']()}
                </div>
            )}
            {error && (
                <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {error}
                </div>
            )}

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

            {captcha?.enabled && captcha.siteKey && <Turnstile siteKey={captcha.siteKey} onVerify={onVerify} />}

            <Button type="submit" size="lg" disabled={submitting || missingLink || captchaBlocking}>
                {submitting ? m['common.states.saving']() : m['auth.reset.submit']()}
            </Button>

            <a href={abs('/auth/login')} className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                {m['auth.backToLogin']()}
            </a>
        </form>
    );
}
