import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { compressAdvanced, type ArchiveFormat } from '@/api/files';

// Format list mirrors the formats wings-rs accepts (see WingsRsController's
// `compressAdvanced` validation). The plain Go daemon has no format selection,
// so this modal is only reachable on supercharged nodes.
const FORMATS: { value: ArchiveFormat; label: string; descriptionKey: keyof typeof DESCRIPTIONS }[] = [
    { value: 'tar_gz', label: '.tar.gz', descriptionKey: 'tar_gz' },
    { value: 'tar_zstd', label: '.tar.zst', descriptionKey: 'tar_zstd' },
    { value: 'tar_lz4', label: '.tar.lz4', descriptionKey: 'tar_lz4' },
    { value: 'tar_xz', label: '.tar.xz', descriptionKey: 'tar_xz' },
    { value: 'tar_bz2', label: '.tar.bz2', descriptionKey: 'tar_bz2' },
    { value: 'tar_lzip', label: '.tar.lz', descriptionKey: 'tar_lzip' },
    { value: 'zip', label: '.zip', descriptionKey: 'zip' },
    { value: 'seven_zip', label: '.7z', descriptionKey: 'seven_zip' },
    { value: 'tar', label: '.tar', descriptionKey: 'tar' },
];

const DESCRIPTIONS = {
    tar_gz: () => m['server.files.compress.format.tarGz'](),
    tar_zstd: () => m['server.files.compress.format.tarZstd'](),
    tar_lz4: () => m['server.files.compress.format.tarLz4'](),
    tar_xz: () => m['server.files.compress.format.tarXz'](),
    tar_bz2: () => m['server.files.compress.format.tarBz2'](),
    tar_lzip: () => m['server.files.compress.format.tarLzip'](),
    zip: () => m['server.files.compress.format.zip'](),
    seven_zip: () => m['server.files.compress.format.sevenZip'](),
    tar: () => m['server.files.compress.format.tar'](),
};

export function CompressModal({
    uuid,
    directory,
    files,
    open,
    onClose,
    onDone,
}: {
    uuid: string;
    directory: string;
    files: string[];
    open: boolean;
    onClose: () => void;
    onDone?: () => void;
}) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [format, setFormat] = useState<ArchiveFormat>('tar_gz');
    const [name, setName] = useState('');

    const mutation = useMutation({
        mutationFn: () =>
            compressAdvanced(uuid, { root: directory, files, format, name: name.trim() || undefined }),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.compressed']() });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid] });
            setName('');
            onClose();
            onDone?.();
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['server.files.compress.title']()}
            description={m['server.files.compress.subtitle']()}
            size="md"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.files.compress.action']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div>
                    <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                        {m['server.files.compress.format.label']()}
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {FORMATS.map(f => (
                            <button
                                key={f.value}
                                type="button"
                                onClick={() => setFormat(f.value)}
                                className={`rounded-[var(--radius-card)] border p-2.5 text-left transition-colors ${
                                    format === f.value
                                        ? 'border-[var(--brand)] bg-[var(--brand)]/10'
                                        : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                                }`}
                            >
                                <p className="font-mono text-sm font-medium text-[var(--color-ink)]">{f.label}</p>
                                <p className="text-[11px] text-[var(--color-ink-faint)]">
                                    {DESCRIPTIONS[f.descriptionKey]()}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                        {m['server.files.compress.name']()}
                    </label>
                    <Input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={m['server.files.compress.namePlaceholder']()}
                    />
                </div>

                <p className="text-xs text-[var(--color-ink-faint)]">
                    {m['server.files.compress.summary']({ count: files.length, path: directory || '/' })}
                </p>
            </div>
        </Modal>
    );
}
