import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { updatePassword } from '@/api/account';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsCard } from './SettingsCard';

export function PasswordForm() {
    const push = useFlashes(s => s.push);

    const [current, setCurrent] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Backend enforces these too; validating here keeps the round-trip cheap and
    // surfaces the mismatch inline before submit.
    const tooShort = password.length > 0 && password.length < 8;
    const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
    const valid = current.length > 0 && password.length >= 8 && confirmPassword === password;

    const mutation = useMutation({
        mutationFn: () => updatePassword({ current, password, confirmPassword }),
        onSuccess: () => {
            setCurrent('');
            setPassword('');
            setConfirmPassword('');
            push({ type: 'success', message: m['account.password.success']() });
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['account.password.error']() }),
    });

    return (
        <SettingsCard title={m['account.password.title']()} description={m['account.password.description']()} icon={KeyRound}>
            <form
                className="flex flex-col gap-4"
                onSubmit={e => {
                    e.preventDefault();
                    if (valid) mutation.mutate();
                }}
            >
                <Field label={m['account.password.current']()} htmlFor="account-current-password">
                    <Input
                        id="account-current-password"
                        type="password"
                        autoComplete="current-password"
                        value={current}
                        onChange={e => setCurrent(e.target.value)}
                    />
                </Field>
                <Field
                    label={m['account.password.new']()}
                    error={tooShort ? m['account.password.tooShort']() : undefined}
                    htmlFor="account-new-password"
                >
                    <Input
                        id="account-new-password"
                        type="password"
                        autoComplete="new-password"
                        invalid={tooShort}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </Field>
                <Field
                    label={m['account.password.confirm']()}
                    error={mismatch ? m['account.password.mismatch']() : undefined}
                    htmlFor="account-confirm-password"
                >
                    <Input
                        id="account-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        invalid={mismatch}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                    />
                </Field>
                <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={!valid || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.password.submit']()}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
