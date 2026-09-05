import { m } from '@/i18n/messages';
import { abs } from '@/lib/base';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { checkUsername, register as registerAccount } from '@/api/auth';
import { acknowledgeRecoveryCode } from '@/api/recoveryCode';
import { firstError } from '@/lib/apiError';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Turnstile } from '@/components/auth/Turnstile';
import { SsoButtons } from '@/components/auth/SsoButtons';
import { PasswordInput, PasswordStrength, passwordMeetsPolicy } from '@/components/auth/PasswordStrength';
import { RecoveryCodeDisplay } from '@/components/auth/RecoveryCodeDisplay';

type FormValues = { username: string; email: string; password: string; passwordConfirmation: string };
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

export default function RegisterPage() {
    const captcha = useFlags(s => s.site?.captcha);
    const [token, setToken] = useState<string | undefined>(undefined);
    const [submitError, setSubmitError] = useState<string | null>(null);
    // Server-authored jGuard copy (admin-configurable), set only when the account
    // was created but held for approval.
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    // After a successful signup we hold the one-time recovery code and gate the
    // redirect behind an explicit acknowledgement so the user cannot miss it.
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [intendedUrl, setIntendedUrl] = useState(abs());

    const schema = useMemo(
        () =>
            z.object({
                username: z.string().min(3, m['auth.register.usernameMin']()),
                email: z.string().email(m['auth.register.emailInvalid']()),
                password: z.string().min(1, m['auth.register.passwordRequired']()),
                passwordConfirmation: z.string().min(1, m['auth.register.passwordRequired']()),
            }),
        [],
    );

    const {
        register,
        handleSubmit,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() opts out of the react compiler
    const password = watch('password') ?? '';
    const username = watch('username') ?? '';

    // Debounced availability check — mirrors V1 RegisterContainer, simplified.
    useEffect(() => {
        const value = username.trim();
        if (value.length < 3) {
            setUsernameStatus('idle');
            return;
        }
        setUsernameStatus('checking');
        const id = setTimeout(() => {
            checkUsername(value)
                .then(res => setUsernameStatus(res.available ? 'available' : 'taken'))
                .catch(() => setUsernameStatus('idle'));
        }, 500);
        return () => clearTimeout(id);
    }, [username]);

    const onVerify = useCallback((t: string) => setToken(t), []);

    const onSubmit = handleSubmit(async values => {
        setSubmitError(null);
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
            setSubmitError(parsed.error.issues[0]?.message ?? m['common.states.genericError']());
            return;
        }
        if (!passwordMeetsPolicy(values.password)) {
            setSubmitError(m['auth.register.passwordWeak']());
            return;
        }
        if (values.password !== values.passwordConfirmation) {
            setSubmitError(m['auth.register.passwordMismatch']());
            return;
        }
        try {
            const res = await registerAccount({
                username: values.username,
                email: values.email,
                password: values.password,
                passwordConfirmation: values.passwordConfirmation,
                captchaToken: token,
            });
            if (res.complete) {
                const target = res.intended || abs();
                // Auto-login already succeeded; interpose the one-time recovery-code
                // reveal before navigating. Missing code (unexpected) → just redirect.
                if (res.recoveryCode) {
                    setIntendedUrl(target);
                    setRecoveryCode(res.recoveryCode);
                } else {
                    window.location.href = target;
                }
                return;
            }
            // jGuard: account created but awaiting staff approval — no session issued.
            // The recovery code is still surfaced, since a pending user never
            // reaches the post-login reveal and cannot be given it afterwards.
            setRecoveryCode(res.recoveryCode ?? null);
            setPendingMessage(res.pendingMessage ?? m['auth.register.pendingBody']());
        } catch (err) {
            setSubmitError(firstError(err) ?? m['common.states.genericError']());
        }
    });

    // Pending wins over the plain recovery reveal: there is no session to
    // continue into, so the code is shown inline here instead.
    if (pendingMessage) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.register.pendingTitle']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{pendingMessage}</p>
                </div>
                {recoveryCode && (
                    <>
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['auth.register.recoveryBody']()}</p>
                        <RecoveryCodeDisplay code={recoveryCode} />
                    </>
                )}
                <a
                    href={abs('/auth/login')}
                    className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                    {m['auth.backToLogin']()}
                </a>
            </div>
        );
    }

    if (recoveryCode) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.register.recoveryTitle']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.register.recoveryBody']()}</p>
                </div>
                <RecoveryCodeDisplay code={recoveryCode} />
                <Button
                    size="lg"
                    onClick={async () => {
                        // Clear the "not saved" nudge before navigating away (navigation
                        // would otherwise cancel the request). Best-effort — redirect regardless.
                        await acknowledgeRecoveryCode().catch(() => {});
                        window.location.href = intendedUrl;
                    }}
                >
                    {m['auth.register.recoveryContinue']()}
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.register.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.register.subtitle']()}</p>
            </div>

            {submitError && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {submitError}
                </div>
            )}

            <Field
                label={m['auth.register.usernameLabel']()}
                htmlFor="username"
                error={errors.username?.message}
                hint={
                    usernameStatus === 'checking'
                        ? m['auth.register.usernameChecking']()
                        : usernameStatus === 'available'
                          ? m['auth.register.usernameAvailable']()
                          : usernameStatus === 'taken'
                            ? m['auth.register.usernameTaken']()
                            : undefined
                }
            >
                <Input
                    id="username"
                    autoComplete="username"
                    invalid={!!errors.username || usernameStatus === 'taken'}
                    {...register('username')}
                />
            </Field>

            <Field label={m['auth.register.emailLabel']()} htmlFor="email" error={errors.email?.message}>
                <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
            </Field>

            <Field label={m['auth.register.passwordLabel']()} htmlFor="password" error={errors.password?.message}>
                <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    invalid={!!errors.password}
                    {...register('password')}
                />
            </Field>
            {password.length > 0 && <PasswordStrength value={password} />}

            <Field
                label={m['auth.register.confirmLabel']()}
                htmlFor="passwordConfirmation"
                error={errors.passwordConfirmation?.message}
            >
                <PasswordInput
                    id="passwordConfirmation"
                    autoComplete="new-password"
                    invalid={!!errors.passwordConfirmation}
                    {...register('passwordConfirmation')}
                />
            </Field>

            {captcha?.enabled && captcha.siteKey && <Turnstile siteKey={captcha.siteKey} onVerify={onVerify} />}

            <Button
                type="submit"
                size="lg"
                disabled={
                    isSubmitting ||
                    usernameStatus === 'taken' ||
                    Boolean(captcha?.enabled && captcha.siteKey && !token)
                }
            >
                {isSubmitting ? m['auth.register.submitting']() : m['auth.register.submit']()}
            </Button>

            <SsoButtons captchaToken={token} onError={setSubmitError} />

            <a href={abs('/auth/login')} className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                {m['auth.register.haveAccount']()}
            </a>
        </form>
    );
}
