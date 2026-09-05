import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { createDirectory, renameFiles } from '@/api/files';
import { join } from '../paths';

// Client-side name validation, mirroring V1's RenameFileModal + the backend
// RenameFileRequest rules. `allowNested` permits `/` (move into subfolders).
function validateFileName(value: string, allowNested: boolean): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return m['server.files.errors.nameRequired']();
    if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return m['server.files.errors.leadingSlash']();
    if (/^[A-Za-z]:/.test(trimmed) || trimmed.split('/').some(seg => /^[A-Za-z]:/.test(seg)))
        return m['server.files.errors.driveLetter']();
    if (trimmed.includes('\0')) return m['server.files.errors.invalidChars']();
    if (trimmed.split('/').some(seg => seg === '..')) return m['server.files.errors.traversal']();
    if (!allowNested && trimmed.includes('/')) return m['server.files.errors.noNested']();
    const segmentPattern = /^[A-Za-z0-9._ -]+$/;
    if (trimmed.split('/').some(seg => !segmentPattern.test(seg))) return m['server.files.errors.invalidChars']();
    return undefined;
}

function useFilesInvalidate(uuid: string) {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: ['server-files', uuid] });
}

export function NewDirectoryModal({
    uuid,
    directory,
    open,
    onClose,
}: {
    uuid: string;
    directory: string;
    open: boolean;
    onClose: () => void;
}) {
    const push = useFlashes(s => s.push);
    const invalidate = useFilesInvalidate(uuid);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | undefined>();

    const mutation = useMutation({
        mutationFn: () => createDirectory(uuid, directory, name.trim()),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.dirCreated']() });
            await invalidate();
            reset();
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    const reset = () => {
        setName('');
        setError(undefined);
        onClose();
    };

    const submit = () => {
        const err = validateFileName(name, true);
        if (err) return setError(err);
        mutation.mutate();
    };

    return (
        <Modal
            open={open}
            onClose={reset}
            title={m['server.files.newDirectory']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={reset} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.create']()}
                    </Button>
                </>
            }
        >
            <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                {m['server.files.folderName']()}
            </label>
            <Input
                autoFocus
                value={name}
                onChange={e => {
                    setName(e.target.value);
                    setError(undefined);
                }}
                onKeyDown={e => e.key === 'Enter' && submit()}
                invalid={!!error}
                placeholder="config"
            />
            {error && <p className="mt-1.5 text-xs text-[var(--color-danger)]">{error}</p>}
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                {m['server.files.newLocation']({ path: join(directory, name.trim() || '…').replace(/^\/+/, '') })}
            </p>
        </Modal>
    );
}

export function RenameMoveModal({
    uuid,
    directory,
    files,
    mode,
    open,
    onClose,
    onDone,
}: {
    uuid: string;
    directory: string;
    files: string[];
    mode: 'rename' | 'move';
    open: boolean;
    onClose: () => void;
    onDone?: () => void;
}) {
    const push = useFlashes(s => s.push);
    const invalidate = useFilesInvalidate(uuid);
    const isMove = mode === 'move';
    const [name, setName] = useState(files.length === 1 && !isMove ? (files[0] ?? '') : '');
    const [error, setError] = useState<string | undefined>();

    const mutation = useMutation({
        mutationFn: () => {
            const value = name.trim();
            const payload =
                isMove && files.length > 1
                    ? files.map(f => ({ from: f, to: join(value, f) }))
                    : files.map(f => ({ from: f, to: value }));
            return renameFiles(uuid, directory, payload);
        },
        onSuccess: async () => {
            push({ type: 'success', message: isMove ? m['server.files.moved']() : m['server.files.renamed']() });
            await invalidate();
            close();
            onDone?.();
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    const close = () => {
        setError(undefined);
        onClose();
    };

    const submit = () => {
        const err = validateFileName(name, isMove);
        if (err) return setError(err);
        mutation.mutate();
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title={isMove ? m['server.files.moveTitle']() : m['server.files.renameTitle']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={close} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {isMove ? m['server.files.move']() : m['server.files.rename']()}
                    </Button>
                </>
            }
        >
            <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                {isMove ? m['server.files.destination']() : m['server.files.fileName']()}
            </label>
            <Input
                autoFocus
                value={name}
                onChange={e => {
                    setName(e.target.value);
                    setError(undefined);
                }}
                onKeyDown={e => e.key === 'Enter' && submit()}
                invalid={!!error}
            />
            {error && <p className="mt-1.5 text-xs text-[var(--color-danger)]">{error}</p>}
            {isMove && (
                <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                    {m['server.files.newLocation']({
                        path: join(directory, name.trim() || '…').replace(/^\/+/, ''),
                    })}
                </p>
            )}
        </Modal>
    );
}
