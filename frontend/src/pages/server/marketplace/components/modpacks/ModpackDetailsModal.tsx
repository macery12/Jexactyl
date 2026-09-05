import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ChevronLeft } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { m, td } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { formatBytes } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import type { Mod } from '@/api/mods';
import {
    getModpackVersions,
    getModpackLoaderStatus,
    previewModpackInstall,
    installModpack,
    type ModpackVersion,
    type ModpackPreview,
} from '@/api/modpacks';
import { queueKey } from '../queueKey';
import { releaseTypeChip } from '../../modMeta';

// Two-step install wizard for a CurseForge modpack:
//   1. pick a version (list)
//   2. review the compatibility preview + choose clean-install / auto-loader,
//      then enqueue the install.
export function ModpackDetailsModal({
    serverId,
    modpack,
    onClose,
}: {
    serverId: string;
    modpack: Mod;
    onClose: () => void;
}) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [version, setVersion] = useState<ModpackVersion | null>(null);
    const [preview, setPreview] = useState<ModpackPreview | null>(null);
    const [wipeServer, setWipeServer] = useState(false);
    const [installLoader, setInstallLoader] = useState(true);

    const versionsQ = useQuery({
        queryKey: ['modpacks', serverId, 'versions', modpack.id],
        queryFn: () => getModpackVersions(serverId, modpack.id),
    });

    const loaderStatusQ = useQuery({
        queryKey: ['modpacks', serverId, 'loader-status'],
        queryFn: () => getModpackLoaderStatus(serverId),
    });

    const previewM = useMutation({
        mutationFn: (v: ModpackVersion) => previewModpackInstall(serverId, modpack.id, v.id),
        onSuccess: (data, v) => {
            setVersion(v);
            setPreview(data);
            // Default: auto-install the loader unless one is already present.
            setInstallLoader(!(loaderStatusQ.data?.has_loader ?? false));
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() }),
    });

    const installM = useMutation({
        mutationFn: () =>
            installModpack(serverId, modpack.id, version!.id, {
                project_id: modpack.id,
                file_id: version!.id,
                modpack_name: modpack.name,
                wipe_server: wipeServer,
                install_loader: installLoader,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: queueKey(serverId) });
            push({ type: 'success', message: m['server.mods.modpacks.queuedToast']() });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() }),
    });

    const versions = versionsQ.data?.data ?? [];
    const inWizard = !!preview && !!version;

    return (
        <Modal
            open
            onClose={onClose}
            title={modpack.name}
            size="lg"
            footer={
                inWizard ? (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setPreview(null);
                                setVersion(null);
                            }}
                            disabled={installM.isPending}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {m['server.mods.modpacks.back']()}
                        </Button>
                        <Button size="sm" onClick={() => installM.mutate()} disabled={installM.isPending}>
                            {installM.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                            {m['server.mods.modpacks.install']()}
                        </Button>
                    </>
                ) : undefined
            }
        >
            {!inWizard ? (
                <div className="flex flex-col gap-4">
                    {modpack.summary && <p className="text-sm text-[var(--color-ink-muted)]">{modpack.summary}</p>}
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                        {m['server.mods.versions']()}
                    </h4>
                    {versionsQ.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : versions.length === 0 ? (
                        <p className="py-4 text-sm text-[var(--color-ink-faint)]">{m['server.mods.noFiles']()}</p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {versions.map(v => (
                                <li
                                    key={v.id}
                                    className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm text-[var(--color-ink)]">{v.name}</span>
                                            <span
                                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${releaseTypeChip(
                                                    v.release_type === 'beta' ? 2 : v.release_type === 'alpha' ? 3 : 1,
                                                )}`}
                                            >
                                                {td(`server.mods.releaseName.${v.release_type}`, v.release_type)}
                                            </span>
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">
                                            {v.game_versions.slice(0, 4).join(', ')}
                                            {v.file_length > 0 && ` · ${formatBytes(v.file_length)}`}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={previewM.isPending}
                                        onClick={() => previewM.mutate(v)}
                                    >
                                        {previewM.isPending && previewM.variables?.id === v.id ? (
                                            <Spinner className="h-4 w-4" />
                                        ) : null}
                                        {m['server.mods.modpacks.select']()}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
                        <p className="font-medium text-[var(--color-ink)]">{preview!.modpack_version}</p>
                        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                            {m['server.mods.modpacks.requires']({
                                version: preview!.minecraft_version ?? '?',
                                loader: preview!.loader ?? '?',
                            })}
                        </p>
                    </div>

                    {(preview!.version_mismatch || preview!.loader_mismatch) && (
                        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{m['server.mods.modpacks.mismatch']()}</span>
                        </div>
                    )}

                    <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5">
                        <Switch checked={wipeServer} onChange={setWipeServer} />
                        <span className="text-sm">
                            <span className="font-medium text-[var(--color-ink)]">{m['server.mods.modpacks.clean']()}</span>
                            <span className="block text-xs text-[var(--color-ink-muted)]">
                                {m['server.mods.modpacks.cleanHint']()}
                            </span>
                        </span>
                    </label>

                    <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5">
                        <Switch checked={installLoader} onChange={setInstallLoader} />
                        <span className="text-sm">
                            <span className="font-medium text-[var(--color-ink)]">
                                {m['server.mods.modpacks.installLoader']()}
                            </span>
                            <span className="block text-xs text-[var(--color-ink-muted)]">
                                {loaderStatusQ.data?.has_loader
                                    ? m['server.mods.modpacks.loaderPresent']({ loader: loaderStatusQ.data.detected ?? '?' })
                                    : m['server.mods.modpacks.installLoaderHint']()}
                            </span>
                        </span>
                    </label>
                </div>
            )}
        </Modal>
    );
}
