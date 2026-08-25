import { m } from '@/i18n/messages';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock3, Info, KeyRound, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import {
    getAdminApiKeys,
    deleteAdminApiKey,
    type AdminApiKey,
} from '@/api/adminApiKeys';
import { timeAgo } from '@/lib/format';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import ApiKeyFormModal from './ApiKeyFormModal';

// A single key in the settings-style list: identifier + description on the left,
// a meta line beneath, and an always-visible Delete control on the right.
function ApiKeyRow({
    apiKey,
    canDelete,
    onDelete,
    now,
}: {
    apiKey: AdminApiKey;
    canDelete: boolean;
    onDelete: (k: AdminApiKey) => void;
    now: number;
}) {
    return (
        <div className="flex items-start justify-between gap-4 px-4 py-4">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-[var(--color-surface-2)] px-2 py-1 font-mono text-xs text-[var(--color-ink)]">
                        {apiKey.identifier}
                    </code>
                    {apiKey.description && (
                        <span className="truncate text-sm text-[var(--color-ink)]">{apiKey.description}</span>
                    )}
                </div>
                <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                    {apiKey.lastUsedAt
                        ? m['admin.api.meta.lastUsed']({ ago: timeAgo(apiKey.lastUsedAt) })
                        : m['admin.api.neverUsed']()}
                    {' · '}
                    {m['admin.api.meta.created']({ ago: timeAgo(apiKey.createdAt) })}
                    {' · '}
                    {apiKey.allowedIps.length > 0 ? apiKey.allowedIps.join(', ') : m['admin.api.anyIp']()}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5">
                        <ShieldCheck className="h-3 w-3" />
                        {apiKey.accessProfile?.name ?? m['admin.access.keys.profileUnavailable']()}
                    </span>
                    {apiKey.creator && (
                        <span className="inline-flex items-center gap-1">
                            <UserRound className="h-3 w-3" />
                            {m['admin.access.keys.createdBy']({ name: apiKey.creator.username })}
                        </span>
                    )}
                    <span
                        className={
                            apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now
                                ? 'inline-flex items-center gap-1 text-[var(--color-danger)]'
                                : 'inline-flex items-center gap-1'
                        }
                    >
                        <Clock3 className="h-3 w-3" />
                        {apiKey.expiresAt
                            ? new Date(apiKey.expiresAt).getTime() <= now
                                ? m['admin.access.keys.expired']({ date: new Date(apiKey.expiresAt).toLocaleString() })
                                : m['admin.access.keys.expires']({ date: new Date(apiKey.expiresAt).toLocaleString() })
                            : m['admin.access.keys.neverExpires']()}
                    </span>
                </div>
                {!apiKey.accessProfile && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2 py-0.5 text-xs text-[var(--color-warning)]">
                            {apiKey.legacy
                                ? m['admin.access.keys.legacyUnbound']()
                                : m['admin.access.keys.missingProfile']()}
                        </span>
                    </div>
                )}
            </div>
            {canDelete && (
                <Button variant="danger" size="sm" onClick={() => onDelete(apiKey)} className="shrink-0">
                    <Trash2 className="h-4 w-4" />
                    {m['common.actions.delete']()}
                </Button>
            )}
        </div>
    );
}

export default function ApiKeysListPage() {
    const held = useAdminHeld();
    const canCreate = can(held, 'api.create');
    const canDelete = can(held, 'api.delete');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [page, setPage] = useState(1);
    const [formOpen, setFormOpen] = useState(false);
    const [toDelete, setToDelete] = useState<AdminApiKey | null>(null);
    const [now] = useState(() => Date.now());

    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: ['admin', 'api-keys', { page }],
        queryFn: () => getAdminApiKeys(page),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    const del = useMutation({
        mutationFn: (id: number) => deleteAdminApiKey(id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.api.deleted']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.access.keys.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {m['admin.access.keys.subtitle']()}
                    </p>
                </div>
                {canCreate && (
                    <Button onClick={() => setFormOpen(true)}>
                        <Plus className="h-4 w-4" />
                        {m['admin.api.create']()}
                    </Button>
                )}
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-ink-muted)]">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                {m['admin.access.keys.hint']()}
            </p>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['admin.api.loadError']()}</p>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <KeyRound className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.api.empty']()}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                        {items.map(key => (
                            <ApiKeyRow key={key.id} apiKey={key} canDelete={canDelete} onDelete={setToDelete} now={now} />
                        ))}
                    </div>
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

            <ApiKeyFormModal open={formOpen} onClose={() => setFormOpen(false)} />

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.api.deleteTitle']()}
                body={m['admin.api.deleteBody']({ identifier: toDelete?.identifier ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                danger
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.id)}
            />
        </div>
    );
}
