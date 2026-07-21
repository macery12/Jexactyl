import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Plus, Trash2 } from 'lucide-react';
import { m } from '@/i18n';
import { getSshKeys, deleteSshKey, type AccountSshKey } from '@/api/credentials';
import { timeAgo } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import SshKeyCreateModal from './SshKeyCreateModal';

function SshKeyRow({ sshKey, onDelete }: { sshKey: AccountSshKey; onDelete: (k: AccountSshKey) => void }) {
    return (
        <div className="flex items-start justify-between gap-4 px-4 py-4">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <Fingerprint className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                    <span className="truncate text-sm font-medium text-[var(--color-ink)]">{sshKey.name}</span>
                </div>
                <p className="mt-1.5 truncate font-mono text-xs text-[var(--color-ink-muted)]">
                    SHA256:{sshKey.fingerprint}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                    {m['account.credentials.ssh.added']({ ago: timeAgo(sshKey.createdAt) })}
                </p>
            </div>
            <Button variant="danger" size="sm" onClick={() => onDelete(sshKey)} className="shrink-0">
                <Trash2 className="h-4 w-4" />
                {m['common.actions.delete']()}
            </Button>
        </div>
    );
}

export default function SshKeysTab() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [formOpen, setFormOpen] = useState(false);
    const [toDelete, setToDelete] = useState<AccountSshKey | null>(null);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['account', 'ssh-keys'],
        queryFn: getSshKeys,
    });

    const del = useMutation({
        mutationFn: (fingerprint: string) => deleteSshKey(fingerprint),
        onSuccess: async () => {
            push({ type: 'success', message: m['account.credentials.ssh.deleted']() });
            await qc.invalidateQueries({ queryKey: ['account', 'ssh-keys'] });
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const items = data ?? [];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <p className="text-sm text-[var(--color-ink-muted)]">{m['account.credentials.ssh.subtitle']()}</p>
                <Button onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {m['account.credentials.ssh.create']()}
                </Button>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                        {m['account.credentials.ssh.loadError']()}
                    </p>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Fingerprint className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['account.credentials.ssh.empty']()}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                        {items.map(key => (
                            <SshKeyRow key={key.fingerprint} sshKey={key} onDelete={setToDelete} />
                        ))}
                    </div>
                )}
            </div>

            <SshKeyCreateModal open={formOpen} onClose={() => setFormOpen(false)} />

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['account.credentials.ssh.deleteTitle']()}
                body={m['account.credentials.ssh.deleteBody']({ name: toDelete?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                danger
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.fingerprint)}
            />
        </div>
    );
}
