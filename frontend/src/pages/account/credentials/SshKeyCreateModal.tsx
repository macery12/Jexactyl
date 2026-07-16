import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { firstError } from '@/lib/apiError';
import { createSshKey } from '@/api/credentials';

// Register a public SSH key against the account.
export default function SshKeyCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();

    const [name, setName] = useState('');
    const [publicKey, setPublicKey] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName('');
        setPublicKey('');
        setError(null);
    }, [open]);

    const mutation = useMutation({
        mutationFn: () => createSshKey(name.trim(), publicKey.trim()),
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: ['account', 'ssh-keys'] });
            onClose();
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    const canSubmit = name.trim().length > 0 && publicKey.trim().length > 0;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['account.credentials.ssh.createTitle']()}
            description={m['account.credentials.ssh.createSubtitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {error && (
                    <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                        {error}
                    </p>
                )}

                <Field label={m['account.credentials.ssh.form.name']()}>
                    <Input value={name} onChange={e => setName(e.target.value)} autoComplete="off" maxLength={191} />
                </Field>

                <Field
                    label={m['account.credentials.ssh.form.publicKey']()}
                    hint={m['account.credentials.ssh.form.publicKeyHint']()}
                >
                    <Textarea
                        value={publicKey}
                        onChange={e => setPublicKey(e.target.value)}
                        rows={5}
                        spellCheck={false}
                        className="font-mono text-xs"
                        placeholder="ssh-ed25519 AAAA…"
                    />
                </Field>
            </div>
        </Modal>
    );
}
