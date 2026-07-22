import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import {
    getDiscordRegistrationData,
    checkDiscordUsername,
    completeDiscordRegistration,
    type DiscordRegistrationData,
} from '@/api/authDiscord';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { PasswordInput, PasswordStrength, passwordMeetsPolicy } from '@/components/auth/PasswordStrength';

type FormValues = { username: string; password: string; passwordConfirmation: string };
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

// Second leg of the Discord signup flow: the OAuth identity is known, the user
// just picks a panel username and an SFTP password. Mirrors the email register
// page's live username check + password policy, minus the email/Turnstile step.
export default function DiscordRegisterPage() {
    const navigate = useNavigate();
    const [data, setData] = useState<DiscordRegistrationData | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');

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
        getDiscordRegistrationData()
            .then(d => {
                if (!active) return;
                setData(d);
                if (d.discord_username) setValue('username', d.discord_username);
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

    // Debounced availability check against the Discord-scoped endpoint.
    useEffect(() => {
        const value = username.trim();
        if (value.length < 3) {
            setUsernameStatus('idle');
            return;
        }
        setUsernameStatus('checking');
        const id = setTimeout(() => {
            checkDiscordUsername(value)
                .then(res => setUsernameStatus(res.available ? 'available' : 'taken'))
                .catch(() => setUsernameStatus('idle'));
        }, 500);
        return () => clearTimeout(id);
    }, [username]);

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
            await completeDiscordRegistration({
                username: values.username,
                password: values.password,
                confirm_password: values.passwordConfirmation,
            });
            // Backend issues the session (or holds it pending under jGuard); a full
            // navigation re-bootstraps the app in its post-login state.
            window.location.href = '/';
        } catch (err) {
            setSubmitError(firstError(err) ?? m['common.states.genericError']());
        }
    });

    if (loadError) {
        return (
            <div className="flex w-full flex-col gap-3 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.discord.errorTitle']()}</h1>
                <p className="text-sm text-[var(--color-danger)]">{m['auth.discord.registerNotFound']()}</p>
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

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.discord.registerTitle']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['auth.discord.registerSubtitle']()}</p>
            </div>

            <div className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/8 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
                    {m['auth.discord.accountLabel']()}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                        <dt className="text-[var(--color-ink-faint)]">{m['auth.discord.email']()}</dt>
                        <dd className="truncate text-[var(--color-ink)]">{data.discord_email}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-[var(--color-ink-faint)]">{m['auth.discord.discordId']()}</dt>
                        <dd className="truncate text-[var(--color-ink)]">{data.discord_id}</dd>
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
                            : m['auth.discord.usernameHint']()
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
                <p className="text-xs text-[var(--color-ink-muted)]">{m['auth.discord.passwordNote']()}</p>
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

            <Button type="submit" size="lg" disabled={isSubmitting || usernameStatus === 'taken'}>
                {isSubmitting ? m['auth.register.submitting']() : m['auth.discord.completeSubmit']()}
            </Button>

            <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className="text-center text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
                {m['auth.discord.cancelToLogin']()}
            </button>
        </form>
    );
}
