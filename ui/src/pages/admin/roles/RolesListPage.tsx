import { m } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Trash2, UserCog } from 'lucide-react';
import { getAdminRoles, deleteRole, type AdminRole } from '@/api/adminRoles';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import RoleCreateModal from './RoleCreateModal';

export default function RolesListPage() {
    const navigate = useNavigate();
    const held = useAdminHeld();
    const canCreate = can(held, 'roles.create');
    const canDelete = can(held, 'roles.delete');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [toDelete, setToDelete] = useState<AdminRole | null>(null);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'roles', { page: 1 }],
        queryFn: () => getAdminRoles({ perPage: 100 }),
    });

    const items = data?.items ?? [];

    const del = useMutation({
        mutationFn: (id: number) => deleteRole(id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.roles.deleted']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.roles.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.roles.subtitle']()}</p>
                </div>
                {canCreate && (
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4" />
                        {m['admin.roles.create']()}
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-14">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : isError ? (
                <p className="py-10 text-center text-sm text-[var(--color-danger)]">{m['admin.roles.loadError']()}</p>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-14 text-center">
                    <UserCog className="h-8 w-8 text-[var(--color-ink-faint)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.roles.empty']()}</p>
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map(role => (
                        <div
                            key={role.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate(`/admin/roles/${role.id}`)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    navigate(`/admin/roles/${role.id}`);
                                }
                            }}
                            className="group flex cursor-pointer flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--color-surface-2)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <span
                                        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                                        style={{ background: role.color ?? 'var(--color-ink-faint)' }}
                                    />
                                    <span className="truncate font-semibold text-[var(--color-ink)]">{role.name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {canDelete && (
                                        <button
                                            type="button"
                                            aria-label={m['common.actions.delete']()}
                                            onClick={e => {
                                                e.stopPropagation();
                                                setToDelete(role);
                                            }}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] opacity-0 transition-all hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] group-hover:opacity-100"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    <ChevronRight className="h-4 w-4 text-[var(--color-ink-faint)]" />
                                </div>
                            </div>
                            <p className="line-clamp-2 min-h-[2.5rem] text-sm text-[var(--color-ink-muted)]">
                                {role.description || m['admin.roles.noDescription']()}
                            </p>
                            <p className="text-xs font-medium text-[var(--color-ink-faint)]">
                                {m['admin.roles.permissionCount']({ count: role.permissions.length })}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            <RoleCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.roles.deleteTitle']()}
                body={m['admin.roles.deleteBody']({ name: toDelete?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.id)}
            />
        </div>
    );
}
