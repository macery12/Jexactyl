import { useQuery } from '@tanstack/react-query';
import { Network, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { useServer } from '@/components/server/ServerContext';
import { useSession } from '@/state/session';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { CopyField } from '@/components/ui/CopyField';
import { getSshInfo } from '@/api/files';

function SshAccess({ uuid }: { uuid: string }) {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['server-ssh', uuid],
        queryFn: () => getSshInfo(uuid),
        staleTime: 5 * 60_000,
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-3">
                <Spinner className="h-5 w-5" />
            </div>
        );
    }
    if (isError || !data) return null;

    const command = data.command || `ssh ${data.username}@${data.host} -p ${data.port}`;

    return (
        <div className="mt-5 flex flex-col gap-3 border-t border-[var(--color-border)] pt-5">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{m['server.files.ssh.title']()}</span>
            <CopyField label={m['server.files.ssh.command']()} value={command} />
            <CopyField label={m['server.files.ssh.host']()} value={`${data.host}:${data.port}`} />
            <CopyField label={m['server.files.ssh.username']()} value={data.username} />
            <div className="border-l-2 border-[var(--color-accent)] pl-3">
                <p className="text-xs text-[var(--color-ink-muted)]">
                    {data.containerSupported ? `${m['server.files.ssh.containerSupported']()} ` : ''}
                    {m['server.files.ssh.usePanelPassword']()}
                </p>
            </div>
        </div>
    );
}

// Slide-in connection details drawer for the file browser: SFTP address/username
// + (on supercharged nodes) SSH access. Overlays the file list without shifting
// the layout, mirroring the admin ExtensionManageDrawer pattern. Ported from
// V1's SshInfoPanel + the connection card in FileManagerContainer.
export function ConnectionPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
    const server = useServer();
    const username = useSession(s => s.user?.username ?? '');
    const sftpUser = `${username}.${server.id}`;
    const address = `sftp://${server.sftp.ip}:${server.sftp.port}`;
    const launchUrl = `sftp://${sftpUser}@${server.sftp.ip}:${server.sftp.port}`;

    return (
        <>
            {/* backdrop */}
            <div
                className={cn(
                    'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
                    open ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
                onClick={onClose}
                aria-hidden
            />

            {/* panel */}
            <aside
                className={cn(
                    'fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl transition-transform duration-200',
                    open ? 'translate-x-0' : 'translate-x-full',
                )}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
                    <div className="flex items-center gap-2">
                        <Network className="h-4 w-4 text-[var(--color-ink-muted)]" />
                        <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                            {m['server.files.connection.title']()}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={m['common.actions.close']()}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    <div className="flex flex-col gap-3">
                        <CopyField label={m['server.files.connection.address']()} value={address} />
                        <CopyField label={m['server.files.connection.username']()} value={sftpUser} />
                        <div className="border-l-2 border-[var(--color-accent)] pl-3">
                            <p className="text-xs text-[var(--color-ink-muted)]">
                                {m['server.files.connection.passwordNote']()}
                            </p>
                        </div>
                        <a href={launchUrl} className="self-start">
                            <Button variant="outline" size="sm">
                                {m['server.files.connection.launch']()}
                            </Button>
                        </a>
                    </div>
                    {open && server.isNodeSupercharged && <SshAccess uuid={server.uuid} />}
                </div>
            </aside>
        </>
    );
}
