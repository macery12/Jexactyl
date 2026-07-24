import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, Fingerprint } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { m } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { getFingerprints, type FileFingerprint, type FingerprintAlgorithm } from '@/api/files';

const ALGORITHMS: { value: FingerprintAlgorithm; label: string }[] = [
    { value: 'sha256', label: 'SHA-256' },
    { value: 'sha512', label: 'SHA-512' },
    { value: 'sha1', label: 'SHA-1' },
    { value: 'md5', label: 'MD5' },
    { value: 'crc32', label: 'CRC32' },
];

// wings-rs checksum viewer — computes fingerprints for one or more files server
// side and lets each hash be copied. Gated on supercharged nodes by the caller.
export function ChecksumModal({
    uuid,
    files,
    open,
    onClose,
}: {
    uuid: string;
    files: string[];
    open: boolean;
    onClose: () => void;
}) {
    const push = useFlashes(s => s.push);
    const [algorithm, setAlgorithm] = useState<FingerprintAlgorithm>('sha256');
    const [results, setResults] = useState<FileFingerprint[]>([]);
    const [copied, setCopied] = useState<string | null>(null);

    const compute = useMutation({
        mutationFn: () => getFingerprints(uuid, files, algorithm),
        onSuccess: setResults,
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    const copy = (hash: string) => {
        navigator.clipboard?.writeText(hash).then(() => {
            setCopied(hash);
            setTimeout(() => setCopied(c => (c === hash ? null : c)), 1500);
        });
    };

    const pick = (value: FingerprintAlgorithm) => {
        setAlgorithm(value);
        setResults([]);
    };

    return (
        <Modal open={open} onClose={onClose} title={m['server.files.checksum.title']()} size="lg">
            <div className="flex flex-col gap-4">
                <div>
                    <label className="mb-1.5 block text-sm text-[var(--color-ink-muted)]">
                        {m['server.files.checksum.algorithm']()}
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {ALGORITHMS.map(a => (
                            <button
                                key={a.value}
                                type="button"
                                onClick={() => pick(a.value)}
                                className={`rounded-[var(--radius-card)] border px-3 py-1.5 text-sm transition-colors ${
                                    algorithm === a.value
                                        ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--color-ink)]'
                                        : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)]'
                                }`}
                            >
                                {a.label}
                            </button>
                        ))}
                    </div>
                </div>

                <p className="text-xs text-[var(--color-ink-faint)]">
                    {m['server.files.checksum.summary']({ count: files.length })}
                </p>

                {results.length === 0 ? (
                    <div className="flex flex-col gap-2">
                        <Button
                            size="sm"
                            className="self-start"
                            onClick={() => compute.mutate()}
                            disabled={compute.isPending}
                        >
                            {compute.isPending ? <Spinner className="h-4 w-4" /> : <Fingerprint className="h-4 w-4" />}
                            {m['server.files.checksum.compute']()}
                        </Button>
                        {compute.isSuccess && (
                            <p className="text-xs text-[var(--color-ink-faint)]">
                                {m['server.files.checksum.empty']()}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="max-h-[420px] space-y-2 overflow-y-auto">
                        {results.map((fp, i) => (
                            <div
                                key={i}
                                className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className="truncate font-mono text-sm text-[var(--color-ink-muted)]">
                                        {fp.path}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => copy(fp.hash)}
                                        title={m['common.actions.copy']()}
                                        className="shrink-0 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                                    >
                                        {copied === fp.hash ? (
                                            <Check className="h-4 w-4 text-[var(--color-success)]" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                                <p className="mt-1 break-all font-mono text-xs text-[var(--color-ink-faint)]">
                                    {fp.hash}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
