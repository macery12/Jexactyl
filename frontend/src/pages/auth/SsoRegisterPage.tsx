import { m } from '@/i18n/messages';
import { abs } from '@/lib/base';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import {
    getSsoRegistrationData,
    checkSsoUsername,
    completeSsoRegistration,
    cancelSsoFlow,
    type SsoRegistrationData,
} from '@/api/authSso';
import { acknowledgeRecoveryCode } from '@/api/recoveryCode';
import { firstError } from '@/lib/apiError';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Turnstile } from '@/components/auth/Turnstile';
import { PasswordInput, PasswordStrength, passwordMeetsPolicy } from '@/components/auth/PasswordStrength';
import { RecoveryCodeDisplay } from '@/components/auth/RecoveryCodeDisplay';
import { DiscordIcon, GoogleIcon } from '@/components/auth/ProviderIcons';

type FormValues = { username: string; password: string; passwordConfirmation: string };
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

/**
 * Second leg of an SSO signup: the provider identity is verified and held in the
 * session, so the user only picks a panel username and a password. Shared by
 * Discord and Google — the provider comes from the session, not the route.
 */
export default function SsoRegisterPage() {
    const navigate = useNavigate();
    const captcha = useFlags(s => s.site?.captcha);
    const [data, setData] = useState<SsoRegistrationData | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [intendedUrl, setIntendedUrl] = useState(abs());

    const schema = useMemo(
        () =>
            z.object({
                username: z.string().min(3, m['auth.register.usernameMin']()),
                password: z.string().min(1, m['auth.register.passwordRequired']()),
                passwordConfirmation: z.string().min(1, m['auth.register.passwordRequired']()),
            }),
        [],
    );

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ defaultValues: { username: '', password: '', passwordConfirmation: '' } });

    // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() opts out of the react compiler
    const password = watch('password') ?? '';
    const username = watch('username') ?? '';

    useEffect(() => {
        let active = true;
        getSsoRegistrationData()
            .then(d => {
                if (!active) return;
                setData(d);
                // Prefill with the provider username, stripped to what the panel
                // accepts (letters, numbers, dash, underscore).
                if (d.username) setValue('username', d.username.replace(/[^\w-]/g, ''));
            })
            .catch(() => {
                if (!active) return;
                setLoadError(true);
                setTimeout(() => navigate('/auth/login'), 2000);
            });
        return () => {
            active = false;
        };
    }, [navigate, setValue]);

    useEffect(() => {
        const value = username.trim();
        if (value.length < 3) {
            setUsernameStatus('idle');
            return;
        }
        setUsernameStatus('checking');
        const id = setTimeout(() => {
            checkSsoUsername(value)
                .then(res => setUsernameStatus(res.available ? 'available' : 'taken'))
                .catch(() => setUsernameStatus('idle'));
        }, 500);
        return () => clearTimeout(id);
    }, [username]);

    const onVerify = useCallback((t: string) => setCaptchaToken(t), []);

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
            const res = await completeSsoRegistration({
                username: values.username,
                password: values.password,
                confirmPassword: values.passwordConfirmation,
                captchaToken,
            });

            // jGuard is holding the account — no session was issued.
            if (res.pending) {
                setRecoveryCode(res.recoveryCode ?? null);
                setPendingMessage(res.pendingMessage ?? m['auth.pending.body']());
                return;
            }

            const target = res.intended || abs();
            if (res.recoveryCode) {
                setIntendedUrl(target);
                setRecoveryCode(res.recoveryCode);
            } else {
                window.location.href = target;
            }
        } catch (err) {
            setSubmitError(firstError(err) ?? m['common.states.genericError']());
        }
    });

    if (loadError) {
        return (
            <div className="flex w-full flex-col gap-3 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.sso.errorTitle']()}</h1>
                <p className="text-sm text-[var(--color-danger)]">{m['auth.sso.sessionNotFound']()}</p>
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

    // Awaiting approval. The recovery code is still shown, since a pending user
    // never reaches the post-login reveal and cannot be given it later.
    if (pendingMessage) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.pending.title']()}</h1>
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
                        await acknowledgeRecoveryCode().catch(() => {});
                        window.location.href = intendedUrl;
                    }}
                >
                    {m['auth.register.recoveryContinue']()}
                </Button>
            </div>
        );
    }

    const Icon = data.provider === 'discord' ? DiscordIcon : GoogleIcon;

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                    {m['auth.sso.registerTitle']({ provider: data.provider_label })}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.sso.registerSubtitle']()}</p>
            </div>

            <div className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/8 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
                    <Icon className="h-3.5 w-3.5" />
                    {m['auth.sso.accountLabel']({ provider: data.provider_label })}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                        <dt className="text-[var(--color-ink-faint)]">{m['auth.sso.email']()}</dt>
                        <dd className="truncate text-[var(--color-ink)]">{data.email ?? '—'}</dd>
                    </div>
                </dl>
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
                            : m['auth.sso.usernameHint']()
                }
            >
                <Input
                    id="username"
                    autoComplete="username"
                    invalid={!!errors.username || usernameStatus === 'taken'}
                    {...register('username')}
                />
            </Field>

            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-4 py-3">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                <p className="text-xs text-[var(--color-ink-muted)]">
                    {m['auth.sso.passwordNote']({ provider: data.provider_label })}
                </p>
            </div>

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
                    Boolean(captcha?.enabled && captcha.siteKey && !captchaToken)
                }
            >
                {isSubmitting ? m['auth.register.submitting']() : m['auth.sso.completeSubmit']()}
            </Button>

            <button
                type="button"
                onClick={async () => {
                    await cancelSsoFlow();
                    navigate('/auth/login');
                }}
                className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
                {m['auth.sso.cancelToLogin']()}
            </button>
        </form>
    );
}
