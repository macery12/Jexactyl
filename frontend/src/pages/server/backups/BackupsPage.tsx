import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useServerSocket } from '@/state/serverSocket';
import { SocketEvent } from '@/lib/Websocket';
import { useFlashes } from '@/state/flashes';
import {
    getBackups,
    getBackupDownloadUrl,
    restoreBackup,
    toggleBackupLock,
    deleteBackup,
    type Backup,
} from '@/api/backups';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import BackupRow from './BackupRow';
import CreateBackupModal from './CreateBackupModal';

type Dialog = { kind: 'restore' | 'delete' | 'unlock'; backup: Backup } | null;

export default function BackupsPage() {
    const server = useServer();
    const canCreate = can(server.permissions, 'backup.create');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const socket = useServerSocket(s => s.instance);

    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const [dialog, setDialog] = useState<Dialog>(null);

    const key = ['server', server.id, 'backups'];
    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: [...key, page],
        queryFn: () => getBackups(server.uuid, page),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;
    const limit = server.featureLimits.backups;
    const disabled = limit === 0;
    const count = data?.backupCount ?? 0;
    const atLimit = !disabled && count >= limit;

    const invalidate = () => qc.invalidateQueries({ queryKey: key });

    // Wings emits `backup completed:<uuid>` when an archive finishes; refetch so
    // the row picks up its real size, checksum and success state. Joined into a
    // string so the effect only re-subscribes when the pending set really changes.
    const pendingKey = items
        .filter(b => b.completedAt === null)
        .map(b => b.uuid)
        .join(',');
    useEffect(() => {
        if (!socket || !pendingKey) return;
        const events = pendingKey.split(',').map(uuid => `${SocketEvent.BACKUP_COMPLETED}:${uuid}`);
        const handler = () => qc.invalidateQueries({ queryKey: ['server', server.id, 'backups'] });
        events.forEach(e => socket.on(e, handler));
        return () => events.forEach(e => socket.off(e, handler));
    }, [socket, pendingKey, qc, server.id]);

    const download = useMutation({
        mutationFn: (backup: Backup) => getBackupDownloadUrl(server.uuid, backup.uuid),
        onSuccess: url => {
            window.location.href = url;
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const restore = useMutation({
        mutationFn: ({ backup, truncate }: { backup: Backup; truncate: boolean }) =>
            restoreBackup(server.uuid, backup.uuid, truncate),
        onSuccess: () => {
            push({ type: 'success', message: m['server.backups.restoreStarted']() });
            setDialog(null);
            // The server drops into `restoring_backup`; refresh the detail too.
            qc.invalidateQueries({ queryKey: ['server', server.id] });
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const toggleLock = useMutation({
        mutationFn: (backup: Backup) => toggleBackupLock(server.uuid, backup.uuid),
        onSuccess: () => {
            setDialog(null);
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const remove = useMutation({
        mutationFn: (backup: Backup) => deleteBackup(server.uuid, backup.uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.backups.deleted']() });
            setDialog(null);
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    // Unlocking is a confirm step; locking is immediate.
    const onToggleLock = (backup: Backup) =>
        backup.isLocked ? setDialog({ kind: 'unlock', backup }) : toggleLock.mutate(backup);

    const busy = restore.isPending || remove.isPending || toggleLock.isPending;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.backups.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.backups.subtitle']()}</p>
                </div>
                {canCreate && !disabled && (
                    <div className="flex flex-col items-end gap-1">
                        <Button onClick={() => setCreating(true)} disabled={atLimit}>
                            <Plus className="h-4 w-4" />
                            {m['server.backups.addBackup']()}
                        </Button>
                        <span className="text-xs text-[var(--color-ink-faint)]">
                            {m['server.backups.limit']({ used: count, total: limit })}
                        </span>
                    </div>
                )}
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                        {m['server.backups.loadError']()}
                    </p>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Archive className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">
                            {disabled
                                ? m['server.backups.notAllowed']()
                                : page > 1
                                  ? m['server.backups.emptyPage']()
                                  : m['server.backups.empty']()}
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {items.map(backup => (
                            <BackupRow
                                key={backup.uuid}
                                backup={backup}
                                onDownload={() => download.mutate(backup)}
                                onRestore={() => setDialog({ kind: 'restore', backup })}
                                onToggleLock={() => onToggleLock(backup)}
                                onDelete={() => setDialog({ kind: 'delete', backup })}
                            />
                        ))}
                    </ul>
                )}
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.currentPage, total: pagination.totalPages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage <= 1 || isFetching}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage >= pagination.totalPages || isFetching}
                            onClick={() => setPage(p => p + 1)}
                        >
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {creating && <CreateBackupModal onClose={() => setCreating(false)} />}

            {/* Rendered conditionally so each open starts with a fresh truncate toggle. */}
            {dialog?.kind === 'restore' && (
                <ConfirmDialog
                    open
                    onClose={() => setDialog(null)}
                    title={m['server.backups.restoreTitle']({ name: dialog.backup.name })}
                    body={m['server.backups.restoreBody']()}
                    confirmLabel={m['server.backups.restore']()}
                    cancelLabel={m['common.actions.cancel']()}
                    danger={false}
                    busy={busy}
                    force={{ label: m['server.backups.restoreTruncate']() }}
                    onConfirm={truncate => restore.mutate({ backup: dialog.backup, truncate })}
                />
            )}

            {dialog?.kind === 'delete' && (
                <ConfirmDialog
                    open
                    onClose={() => setDialog(null)}
                    title={m['server.backups.deleteTitle']({ name: dialog.backup.name })}
                    body={m['server.backups.deleteBody']()}
                    confirmLabel={m['common.actions.delete']()}
                    cancelLabel={m['common.actions.cancel']()}
                    busy={busy}
                    onConfirm={() => remove.mutate(dialog.backup)}
                />
            )}

            {dialog?.kind === 'unlock' && (
                <ConfirmDialog
                    open
                    onClose={() => setDialog(null)}
                    title={m['server.backups.unlockTitle']({ name: dialog.backup.name })}
                    body={m['server.backups.unlockBody']()}
                    confirmLabel={m['server.backups.unlock']()}
                    cancelLabel={m['common.actions.cancel']()}
                    danger={false}
                    busy={busy}
                    onConfirm={() => toggleLock.mutate(dialog.backup)}
                />
            )}
        </div>
    );
}
