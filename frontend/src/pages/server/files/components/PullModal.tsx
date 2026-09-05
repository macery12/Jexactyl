import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { pullFile } from '@/api/files';

// Remote-download modal — hands a URL to the daemon, which fetches the file
// straight into the current directory (no round-trip through the browser).
// Backed by /files/pull (file.create), available on both daemon types.
export function PullModal({
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
    const qc = useQueryClient();
    const [url, setUrl] = useState('');
    const [filename, setFilename] = useState('');
    const [error, setError] = useState<string | undefined>();

    const reset = () => {
        setUrl('');
        setFilename('');
        setError(undefined);
        onClose();
    };

    const mutation = useMutation({
        mutationFn: () => pullFile(uuid, { url: url.trim(), directory, filename: filename.trim() }),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.pull.started']() });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
            reset();
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    const submit = () => {
        const value = url.trim();
        if (!value) return setError(m['server.files.pull.urlRequired']());
        if (!/^https?:\/\//i.test(value)) return setError(m['server.files.pull.urlInvalid']());
        mutation.mutate();
    };

    return (
        <Modal
            open={open}
            onClose={reset}
            title={m['server.files.pull.title']()}
            description={m['server.files.pull.description']()}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={reset} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.files.pull.action']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div>
                    <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                        {m['server.files.pull.urlLabel']()}
                    </label>
                    <Input
                        autoFocus
                        value={url}
                        onChange={e => {
                            setUrl(e.target.value);
                            setError(undefined);
                        }}
                        onKeyDown={e => e.key === 'Enter' && submit()}
                        invalid={!!error}
                        placeholder="https://example.com/file.jar"
                    />
                    {error && <p className="mt-1.5 text-xs text-[var(--color-danger)]">{error}</p>}
                </div>
                <div>
                    <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                        {m['server.files.pull.filenameLabel']()}
                    </label>
                    <Input
                        value={filename}
                        onChange={e => setFilename(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submit()}
                        placeholder={m['server.files.pull.filenamePlaceholder']()}
                    />
                    <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                        {m['server.files.pull.filenameHint']()}
                    </p>
                </div>
            </div>
        </Modal>
    );
}
