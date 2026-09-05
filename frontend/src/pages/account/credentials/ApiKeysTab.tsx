import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { m } from '@/i18n/messages';
import { getApiKeys, deleteApiKey, type AccountApiKey } from '@/api/credentials';
import { timeAgo } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import ApiKeyCreateModal from './ApiKeyCreateModal';

function ApiKeyRow({ apiKey, onDelete }: { apiKey: AccountApiKey; onDelete: (k: AccountApiKey) => void }) {
    return (
        <div className="flex items-start justify-between gap-4 px-4 py-4">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                    <span className="truncate text-sm text-[var(--color-ink)]">{apiKey.description}</span>
                    <code className="rounded bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-ink-muted)]">
                        {apiKey.identifier}
                    </code>
                </div>
                <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                    {apiKey.lastUsedAt
                        ? m['account.credentials.api.lastUsed']({ ago: timeAgo(apiKey.lastUsedAt) })
                        : m['account.credentials.api.neverUsed']()}
                    {' · '}
                    {apiKey.allowedIps.length > 0
                        ? apiKey.allowedIps.join(', ')
                        : m['account.credentials.api.anyIp']()}
                </p>
            </div>
            <Button variant="danger" size="sm" onClick={() => onDelete(apiKey)} className="shrink-0">
                <Trash2 className="h-4 w-4" />
                {m['common.actions.delete']()}
            </Button>
        </div>
    );
}

export default function ApiKeysTab() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [formOpen, setFormOpen] = useState(false);
    const [toDelete, setToDelete] = useState<AccountApiKey | null>(null);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['account', 'api-keys'],
        queryFn: getApiKeys,
    });

    const del = useMutation({
        mutationFn: (identifier: string) => deleteApiKey(identifier),
        onSuccess: async () => {
            push({ type: 'success', message: m['account.credentials.api.deleted']() });
            await qc.invalidateQueries({ queryKey: ['account', 'api-keys'] });
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const items = data ?? [];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <p className="text-sm text-[var(--color-ink-muted)]">{m['account.credentials.api.subtitle']()}</p>
                <Button onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {m['account.credentials.api.create']()}
                </Button>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                        {m['account.credentials.api.loadError']()}
                    </p>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <KeyRound className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['account.credentials.api.empty']()}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                        {items.map(key => (
                            <ApiKeyRow key={key.identifier} apiKey={key} onDelete={setToDelete} />
                        ))}
                    </div>
                )}
            </div>

            <ApiKeyCreateModal open={formOpen} onClose={() => setFormOpen(false)} />

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['account.credentials.api.deleteTitle']()}
                body={m['account.credentials.api.deleteBody']({ identifier: toDelete?.identifier ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                danger
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.identifier)}
            />
        </div>
    );
}
