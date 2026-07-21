import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { updateEmail } from '@/api/account';
import { firstError } from '@/lib/apiError';
import { useSession } from '@/state/session';
import { useFlashes } from '@/state/flashes';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsCard } from './SettingsCard';

export function EmailForm() {
    const user = useSession(s => s.user);
    const setUser = useSession(s => s.setUser);
    const push = useFlashes(s => s.push);

    const [email, setEmail] = useState(user?.email ?? '');
    const [password, setPassword] = useState('');

    const mutation = useMutation({
        mutationFn: () => updateEmail(email, password),
        onSuccess: () => {
            if (user) setUser({ ...user, email });
            setPassword('');
            push({ type: 'success', message: m['account.email.success']() });
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['account.email.error']() }),
    });

    const dirty = email.trim() !== (user?.email ?? '') && password.length > 0;

    return (
        <SettingsCard title={m['account.email.title']()} description={m['account.email.description']()} icon={Mail}>
            <form
                className="flex flex-col gap-4"
                onSubmit={e => {
                    e.preventDefault();
                    if (dirty) mutation.mutate();
                }}
            >
                <Field label={m['account.email.newEmail']()} htmlFor="account-email">
                    <Input
                        id="account-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                    />
                </Field>
                <Field
                    label={m['account.email.currentPassword']()}
                    hint={m['account.email.passwordHint']()}
                    htmlFor="account-email-password"
                >
                    <Input
                        id="account-email-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </Field>
                <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={!dirty || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.email.submit']()}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
