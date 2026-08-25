import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Archive, Lock, Unlock, MoreVertical, Download, Box, Trash2, type LucideIcon } from 'lucide-react';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { cn } from '@/lib/cn';
import { formatBytes, timeAgo } from '@/lib/format';
import { useServer } from '@/components/server/ServerContext';
import { Spinner } from '@/components/ui/Spinner';
import type { Backup } from '@/api/backups';

function Item({
    icon: Icon,
    label,
    onSelect,
    danger,
}: {
    icon: LucideIcon;
    label: string;
    onSelect: () => void;
    danger?: boolean;
}) {
    return (
        <Dropdown.Item
            onSelect={onSelect}
            className={cn(
                'flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--color-surface-2)]',
                danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]',
            )}
        >
            <Icon className="h-3.5 w-3.5" /> {label}
        </Dropdown.Item>
    );
}

export default function BackupRow({
    backup,
    onDownload,
    onRestore,
    onToggleLock,
    onDelete,
}: {
    backup: Backup;
    onDownload: () => void;
    onRestore: () => void;
    onToggleLock: () => void;
    onDelete: () => void;
}) {
    const held = useServer().permissions;
    const canDownload = can(held, 'backup.download');
    const canRestore = can(held, 'backup.restore');
    const canDelete = can(held, 'backup.delete');

    const inProgress = backup.completedAt === null;
    const failed = !inProgress && !backup.isSuccessful;
    // A locked backup can't be deleted or restored over until it's unlocked, and
    // an unfinished one has nothing to download or restore yet.
    const actionable = !inProgress && (canDownload || canRestore || canDelete);

    return (
        <li className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {inProgress ? (
                    <Spinner className="h-4 w-4" />
                ) : backup.isLocked ? (
                    <Lock className="h-4 w-4 text-[var(--color-warning)]" />
                ) : (
                    <Archive className="h-4 w-4 text-[var(--color-ink-faint)]" />
                )}
            </span>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {failed && (
                        <span className="shrink-0 rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-danger)]">
                            {m['server.backups.failed']()}
                        </span>
                    )}
                    <p className="truncate text-sm font-medium text-[var(--color-ink)]">{backup.name}</p>
                    {!inProgress && !failed && (
                        <span className="hidden shrink-0 text-xs text-[var(--color-ink-faint)] sm:inline">
                            {formatBytes(backup.bytes)}
                        </span>
                    )}
                </div>
                {backup.checksum && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink-faint)]">
                        {backup.checksum}
                    </p>
                )}
            </div>

            <div className="hidden shrink-0 text-center md:block">
                <p className="text-sm text-[var(--color-ink)]" title={new Date(backup.createdAt).toLocaleString()}>
                    {timeAgo(backup.createdAt)}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    {m['server.backups.created']()}
                </p>
            </div>

            <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                {/* An in-progress backup can only be cancelled by deleting it. */}
                {inProgress && canDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        title={m['common.actions.delete']()}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-danger)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                ) : actionable ? (
                    <Dropdown.Root>
                        <Dropdown.Trigger
                            aria-label={m['server.backups.actionsLabel']()}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:outline-none"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </Dropdown.Trigger>
                        <Dropdown.Portal>
                            <Dropdown.Content
                                align="end"
                                sideOffset={4}
                                className="z-[60] w-48 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30"
                            >
                                {canDownload && (
                                    <Item icon={Download} label={m['server.backups.download']()} onSelect={onDownload} />
                                )}
                                {canRestore && (
                                    <Item icon={Box} label={m['server.backups.restore']()} onSelect={onRestore} />
                                )}
                                {canDelete && (
                                    <>
                                        <Item
                                            icon={backup.isLocked ? Unlock : Lock}
                                            label={backup.isLocked ? m['server.backups.unlock']() : m['server.backups.lock']()}
                                            onSelect={onToggleLock}
                                        />
                                        {!backup.isLocked && (
                                            <Item
                                                icon={Trash2}
                                                label={m['common.actions.delete']()}
                                                danger
                                                onSelect={onDelete}
                                            />
                                        )}
                                    </>
                                )}
                            </Dropdown.Content>
                        </Dropdown.Portal>
                    </Dropdown.Root>
                ) : null}
            </div>
        </li>
    );
}
