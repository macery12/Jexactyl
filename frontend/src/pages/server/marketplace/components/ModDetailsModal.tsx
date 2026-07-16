import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Star } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { m } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { formatBytes } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { getModFiles, downloadModFile, type Mod, type ModFile, type Resource, type Source } from '@/api/mods';
import { queueKey } from './queueKey';
import { formatCount, primaryAuthor, releaseTypeChip, releaseTypeLabel } from '../modMeta';

// Project detail + version/file list. Downloading enqueues the file and nudges
// the queue query so the header badge / Queue tab update immediately.
export function ModDetailsModal({
    serverId,
    mod,
    source,
    resource,
    onClose,
}: {
    serverId: string;
    mod: Mod;
    source: Source;
    resource: Resource;
    onClose: () => void;
}) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [pendingFile, setPendingFile] = useState<number | string | null>(null);

    const filesQ = useQuery({
        queryKey: ['mods', serverId, 'files', mod.id, source, resource],
        queryFn: () => getModFiles(serverId, mod.id, { source, resource }),
    });

    const download = useMutation({
        mutationFn: (file: ModFile) => downloadModFile(serverId, mod.id, file.id, source, resource),
        onMutate: file => setPendingFile(file.id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queueKey(serverId) });
            push({ type: 'success', message: m['server.mods.queuedToast']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() }),
        onSettled: () => setPendingFile(null),
    });

    const icon = mod.logo?.thumbnailUrl || mod.logo?.url || null;
    const rating = mod.rating?.average ?? mod.latestVersion?.rating?.average;
    const link = mod.links?.websiteUrl || mod.externalUrl || null;
    const files = filesQ.data?.data ?? [];

    return (
        <Modal open onClose={onClose} title={mod.name} size="lg">
            <div className="flex flex-col gap-5">
                <div className="flex items-start gap-4">
                    {icon && (
                        <img
                            src={icon}
                            alt=""
                            width={64}
                            height={64}
                            className="h-16 w-16 shrink-0 rounded-lg border border-[var(--color-border)] object-cover"
                        />
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="text-sm text-[var(--color-ink-muted)]">{primaryAuthor(mod.authors)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-faint)]">
                            <span className="inline-flex items-center gap-1">
                                <Download className="h-3.5 w-3.5" />
                                {formatCount(mod.downloadCount)}
                            </span>
                            {typeof rating === 'number' && rating > 0 && (
                                <span className="inline-flex items-center gap-1">
                                    <Star className="h-3.5 w-3.5" />
                                    {rating.toFixed(1)}
                                </span>
                            )}
                            {link && (
                                <a
                                    href={link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {m['server.mods.website']()}
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                {mod.summary && <p className="text-sm text-[var(--color-ink-muted)]">{mod.summary}</p>}

                <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                        {m['server.mods.versions']()}
                    </h4>
                    {filesQ.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : files.length === 0 ? (
                        <p className="py-4 text-sm text-[var(--color-ink-faint)]">{m['server.mods.noFiles']()}</p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {files.map(file => (
                                <li
                                    key={file.id}
                                    className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm text-[var(--color-ink)]">
                                                {file.displayName || file.fileName}
                                            </span>
                                            <span
                                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${releaseTypeChip(
                                                    file.releaseType,
                                                )}`}
                                            >
                                                {releaseTypeLabel(file.releaseType)}
                                            </span>
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">
                                            {file.gameVersions.slice(0, 4).join(', ')}
                                            {file.fileLength > 0 && ` · ${formatBytes(file.fileLength)}`}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={download.isPending}
                                        onClick={() => download.mutate(file)}
                                    >
                                        {pendingFile === file.id ? (
                                            <Spinner className="h-4 w-4" />
                                        ) : (
                                            <Download className="h-4 w-4" />
                                        )}
                                        {m['server.mods.install']()}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
}
