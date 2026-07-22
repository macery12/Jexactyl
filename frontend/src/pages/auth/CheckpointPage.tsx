import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { checkpoint } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';

// 2FA checkpoint. Phase 1 stub: takes the confirmation token from the query
// string (set by LoginPage) and submits a TOTP/recovery code.
export default function CheckpointPage() {
    const [params] = useSearchParams();
    const confirmationToken = params.get('token') ?? '';
    const [error, setError] = useState<string | null>(null);
    const {
        register,
        handleSubmit,
        formState: { isSubmitting },
    } = useForm<{ code: string; recovery: string }>();

    const onSubmit = handleSubmit(async values => {
        setError(null);
        try {
            const res = await checkpoint({
                confirmationToken,
                code: values.code,
                recoveryToken: values.recovery,
            });
            window.location.assign(res.intended || abs());
        } catch {
            setError(m['auth.checkpoint.codeError']());
        }
    });

    return (
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{m['auth.checkpoint.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                    {m['auth.checkpoint.subtitle']()}
                </p>
            </div>

            {!confirmationToken && (
                <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-warning)]">
                    {m['auth.checkpoint.missingToken']()}
                </div>
            )}
            {error && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    {error}
                </div>
            )}

            <Field label={m['auth.checkpoint.codeLabel']()} htmlFor="code">
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" {...register('code')} />
            </Field>
            <Field label={m['auth.checkpoint.recoveryLabel']()} htmlFor="recovery">
                <Input id="recovery" {...register('recovery')} />
            </Field>

            <Button type="submit" size="lg" disabled={isSubmitting || !confirmationToken}>
                {isSubmitting ? m['auth.checkpoint.submitting']() : m['auth.checkpoint.submit']()}
            </Button>
        </form>
    );
}
