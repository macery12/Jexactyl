import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { deleteDatabase, type ServerDatabase } from '@/api/databases';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

// Type-to-confirm delete. As in V1, either the full prefixed name ('s5_main') or
// the bare suffix the user actually chose ('main') unlocks the button — the
// 's5_' prefix is panel bookkeeping, not something they typed.
export default function DeleteDatabaseModal({
    database,
    onClose,
}: {
    database: ServerDatabase;
    onClose: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [confirm, setConfirm] = useState('');

    const accepted = [database.name, database.name.split('_', 2)[1] ?? ''].filter(Boolean);
    const valid = accepted.includes(confirm.trim());

    const remove = useMutation({
        mutationFn: () => deleteDatabase(server.uuid, database.id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.databases.deleted']() });
            qc.invalidateQueries({ queryKey: ['server', server.id, 'databases'] });
            onClose();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.databases.deleteTitle']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={remove.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => remove.mutate()}
                        disabled={!valid || remove.isPending}
                    >
                        {remove.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.databases.deleteSubmit']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <p className="text-sm text-[var(--color-ink-muted)]">
                    {m['server.databases.deleteBody']({ name: database.name })}
                </p>
                <Field
                    label={m['server.databases.confirmName']()}
                    hint={m['server.databases.confirmNameHint']()}
                    htmlFor="database-confirm"
                >
                    <Input
                        id="database-confirm"
                        value={confirm}
                        autoFocus
                        onChange={e => setConfirm(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && valid && remove.mutate()}
                    />
                </Field>
            </div>
        </Modal>
    );
}
