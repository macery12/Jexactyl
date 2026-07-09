import { m } from '@/i18n';
import { useCallback, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { login } from '@/api/auth';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Turnstile } from '@/components/auth/Turnstile';

type FormValues = { user: string; password: string };

export default function LoginPage() {
    const navigate = useNavigate();
    const captcha = useFlags(s => s.site?.captcha);
    const registrationEnabled = useFlags(s => s.everest?.auth?.registration?.enabled);
    const [token, setToken] = useState<string | undefined>(undefined);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Built inside the component so validation messages are localized.
    const schema = useMemo(
        () =>
            z.object({
                user: z.string().min(1, m['auth.login.userRequired']()),
                password: z.string().min(1, m['auth.login.passwordRequired']()),
            }),
        [],
    );

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>();

    const onVerify = useCallback((t: string) => setToken(t), []);

    const onSubmit = handleSubmit(async values => {
        setSubmitError(null);
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
            setSubmitError(parsed.error.issues[0]?.message ?? m['auth.login.invalidInput']());
            return;
        }
        try {
            const res = await login({ user: values.user, password: values.password, captchaToken: token });
            if (!res.complete && res.confirmationToken) {
                navigate(`/v2/auth/login/checkpoint?token=${encodeURIComponent(res.confirmationToken)}`);
                return;
            }
            window.location.href = res.intended || '/v2';
        } catch (err: unknown) {
            const message =
                (typeof err === 'object' && err && 'response' in err
                    ? // @ts-expect-error narrow axios error shape at runtime
                      err.response?.data?.errors?.[0]?.detail
                    : null) ?? m['auth.login.invalidCredentials']();
            setSubmitError(message);
        }
    });

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.login.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.login.subtitle']()}</p>
            </div>

            {submitError && (
                <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {submitError}
                </div>
            )}

            <Field label={m['auth.login.userLabel']()} htmlFor="user" error={errors.user?.message}>
                <Input id="user" autoComplete="username" invalid={!!errors.user} {...register('user')} />
            </Field>

            <Field label={m['auth.login.passwordLabel']()} htmlFor="password" error={errors.password?.message}>
                <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    invalid={!!errors.password}
                    {...register('password')}
                />
            </Field>

            {captcha?.enabled && captcha.siteKey && <Turnstile siteKey={captcha.siteKey} onVerify={onVerify} />}

            <Button type="submit" size="lg" disabled={isSubmitting || Boolean(captcha?.enabled && captcha.siteKey && !token)}>
                {isSubmitting ? m['auth.login.submitting']() : m['auth.login.submit']()}
            </Button>

            <a href="/v2/auth/password" className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                {m['auth.login.forgot']()}
            </a>

            {registrationEnabled && (
                <a
                    href="/v2/auth/register"
                    className="text-center text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                    {m['auth.login.createAccount']()}
                </a>
            )}
        </form>
    );
}
