import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n/messages';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { createDatabase } from '@/api/databases';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

// Mirrors V1's yup schema so the client rejects the same input the API would.
const NAME_PATTERN = /^[\w\-.]{3,48}$/;
const REMOTE_PATTERN = /^[\w\-/.%:]+$/;

function validateName(value: string): string | null {
    if (value.trim().length === 0) return m['server.databases.errors.nameRequired']();
    if (!NAME_PATTERN.test(value)) return m['server.databases.errors.namePattern']();
    return null;
}

function validateRemote(value: string): string | null {
    // Blank is valid — it becomes '%' (connections from anywhere) on submit.
    if (value.trim().length === 0) return null;
    if (!REMOTE_PATTERN.test(value)) return m['server.databases.errors.remotePattern']();
    return null;
}

export default function CreateDatabaseModal({ onClose }: { onClose: () => void }) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [name, setName] = useState('');
    const [connectionsFrom, setConnectionsFrom] = useState('');
    const [touched, setTouched] = useState(false);

    const nameError = touched ? validateName(name) : null;
    const remoteError = touched ? validateRemote(connectionsFrom) : null;
    const valid = !validateName(name) && !validateRemote(connectionsFrom);

    const create = useMutation({
        mutationFn: () =>
            createDatabase(server.uuid, {
                name: name.trim(),
                connectionsFrom: connectionsFrom.trim() || '%',
            }),
        onSuccess: () => {
            push({ type: 'success', message: m['server.databases.created']() });
            qc.invalidateQueries({ queryKey: ['server', server.id, 'databases'] });
            onClose();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const submit = () => {
        setTouched(true);
        if (valid) create.mutate();
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.databases.createTitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={create.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={create.isPending || (touched && !valid)}>
                        {create.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.databases.createSubmit']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <Field
                    label={m['server.databases.name']()}
                    hint={m['server.databases.nameHint']()}
                    error={nameError ?? undefined}
                    htmlFor="database-name"
                >
                    <Input
                        id="database-name"
                        value={name}
                        autoFocus
                        invalid={!!nameError}
                        onChange={e => setName(e.target.value)}
                        onBlur={() => setTouched(true)}
                        onKeyDown={e => e.key === 'Enter' && submit()}
                    />
                </Field>
                <Field
                    label={m['server.databases.connectionsFrom']()}
                    hint={m['server.databases.connectionsFromHint']()}
                    error={remoteError ?? undefined}
                    htmlFor="database-remote"
                >
                    <Input
                        id="database-remote"
                        value={connectionsFrom}
                        placeholder="%"
                        invalid={!!remoteError}
                        onChange={e => setConnectionsFrom(e.target.value)}
                        onBlur={() => setTouched(true)}
                        onKeyDown={e => e.key === 'Enter' && submit()}
                    />
                </Field>
            </div>
        </Modal>
    );
}
