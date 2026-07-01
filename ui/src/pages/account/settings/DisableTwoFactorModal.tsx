import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { disableTwoFactor } from '@/api/twoFactor';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

// Re-auth with the account password to turn 2FA off. `onDisabled` clears the
// account state on success.
export function DisableTwoFactorModal({
    open,
    onClose,
    onDisabled,
}: {
    open: boolean;
    onClose: () => void;
    onDisabled: () => void;
}) {
    const push = useFlashes(s => s.push);
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    const disable = useMutation({
        mutationFn: () => disableTwoFactor(password),
        onSuccess: () => {
            onDisabled();
            push({ type: 'success', message: m['account.twoFactor.disableSuccess']() });
            onClose();
        },
        onError: (err: unknown) => setError(firstError(err) ?? m['account.twoFactor.error']()),
    });

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['account.twoFactor.disableTitle']()}
            description={m['account.twoFactor.disableDescription']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={disable.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => password && disable.mutate()}
                        disabled={!password || disable.isPending}
                    >
                        {disable.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.twoFactor.disable']()}
                    </Button>
                </>
            }
        >
            <Field label={m['account.twoFactor.password']()} htmlFor="tf-disable-password" error={error ?? undefined}>
                <Input
                    id="tf-disable-password"
                    type="password"
                    autoFocus
                    value={password}
                    invalid={!!error}
                    onChange={e => {
                        setPassword(e.target.value);
                        setError(null);
                    }}
                    onKeyDown={e => e.key === 'Enter' && password && disable.mutate()}
                />
            </Field>
        </Modal>
    );
}
