import { m } from '@/i18n';
import { td } from '@/i18n';
import { abs } from '@/lib/base';
import { useCallback, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '@/api/auth';
import { firstError, errorCode } from '@/lib/apiError';
import { useFlags } from '@/state/flags';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Turnstile } from '@/components/auth/Turnstile';
import { SsoButtons } from '@/components/auth/SsoButtons';

type FormValues = { user: string; password: string };

// Codes the SSO callbacks redirect back with. Anything unrecognised falls back
// to the generic message rather than rendering a raw code.
const SSO_ERROR_KEYS: Record<string, string> = {
    cancelled: 'auth.sso.errors.cancelled',
    invalid_state: 'auth.sso.errors.invalidState',
    missing_code: 'auth.sso.errors.providerError',
    provider_error: 'auth.sso.errors.providerError',
    module_disabled: 'auth.sso.errors.moduleDisabled',
    link_session_expired: 'auth.sso.errors.linkSessionExpired',
    account_unavailable: 'auth.sso.errors.accountUnavailable',
};

export default function LoginPage() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const captcha = useFlags(s => s.site?.captcha);
    const registrationEnabled = useFlags(s => s.everest?.auth?.registration?.enabled);
    const [token, setToken] = useState<string | undefined>(undefined);
    const [submitError, setSubmitError] = useState<string | null>(null);
    // jGuard holds the account — a distinct state from a failed credential check.
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);

    // A failed SSO round-trip comes back as a query code, because the callback is
    // a server redirect. Derived during render rather than pushed into state by an
    // effect — the query string is already the source of truth.
    const ssoError = useMemo(() => {
        const code = params.get('sso_error');
        if (!code) return null;
        // `sso_error_detail` carries server-authored text (a jGuard message, say)
        // that has no localized equivalent here.
        const detail = params.get('sso_error_detail');
        const key = SSO_ERROR_KEYS[code];
        return detail || (key ? td(key) : m['auth.sso.errors.generic']());
    }, [params]);

    // Drop the codes once the user acts, so the banner does not outlive its cause.
    const clearSsoError = useCallback(() => {
        if (!params.has('sso_error') && !params.has('sso_error_detail')) return;
        const next = new URLSearchParams(params);
        next.delete('sso_error');
        next.delete('sso_error_detail');
        setParams(next, { replace: true });
    }, [params, setParams]);

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
        setPendingMessage(null);
        clearSsoError();
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
            setSubmitError(parsed.error.issues[0]?.message ?? m['auth.login.invalidInput']());
            return;
        }
        try {
            const res = await login({ user: values.user, password: values.password, captchaToken: token });
            if (!res.complete && res.confirmationToken) {
                // Hand the confirmation token over in router state rather than the
                // URL, so it never reaches history, `Referer` or access logs.
                navigate('/auth/login/checkpoint', { state: { confirmationToken: res.confirmationToken } });
                return;
            }
            window.location.assign(res.intended || abs());
        } catch (err: unknown) {
            if (errorCode(err) === 'AccountPendingApprovalException') {
                setPendingMessage(firstError(err) ?? m['auth.pending.body']());
                return;
            }
            setSubmitError(firstError(err) ?? m['auth.login.invalidCredentials']());
        }
    });

    if (pendingMessage) {
        return (
            <div className="flex w-full flex-col gap-5">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['auth.pending.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{pendingMessage}</p>
                </div>
                <Button variant="outline" size="lg" onClick={() => setPendingMessage(null)}>
                    {m['auth.backToLogin']()}
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.login.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.login.subtitle']()}</p>
            </div>

            {(submitError ?? ssoError) && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {submitError ?? ssoError}
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

            <SsoButtons
                captchaToken={token}
                onError={message => {
                    clearSsoError();
                    setSubmitError(message);
                }}
            />

            <a href={abs('/auth/password')} className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                {m['auth.login.forgot']()}
            </a>

            {registrationEnabled && (
                <a
                    href={abs('/auth/register')}
                    className="text-center text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                    {m['auth.login.createAccount']()}
                </a>
            )}
        </form>
    );
}
