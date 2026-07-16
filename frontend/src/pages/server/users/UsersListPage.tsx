import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { m } from '@/i18n';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { getSubusers, deleteSubuser, type Subuser } from '@/api/subusers';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import SubuserFormModal from './SubuserFormModal';

export default function UsersListPage() {
    const server = useServer();
    const held = server.permissions;
    const canCreate = can(held, 'user.create');
    const canUpdate = can(held, 'user.update');
    const canDelete = can(held, 'user.delete');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['server', server.id, 'subusers'];

    const { data, isLoading, isError } = useQuery({
        queryKey: key,
        queryFn: () => getSubusers(server.uuid),
    });

    const [formOpen, setFormOpen] = useState(false);
    const [editSubuser, setEditSubuser] = useState<Subuser | null>(null);
    const [toDelete, setToDelete] = useState<Subuser | null>(null);

    const subusers = data ?? [];

    const remove = useMutation({
        mutationFn: (uuid: string) => deleteSubuser(server.uuid, uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.users.removed']() });
            setToDelete(null);
            qc.invalidateQueries({ queryKey: key });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const openCreate = () => {
        setEditSubuser(null);
        setFormOpen(true);
    };
    const openEdit = (s: Subuser) => {
        setEditSubuser(s);
        setFormOpen(true);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.users.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.users.subtitle']()}</p>
                </div>
                {canCreate && (
                    <Button onClick={openCreate}>
                        <Plus className="h-4 w-4" />
                        {m['server.users.add']()}
                    </Button>
                )}
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['server.users.loadError']()}</p>
                ) : subusers.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Users className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['server.users.empty']()}</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {subusers.map(s => (
                            <li key={s.uuid} className="flex items-center gap-4 px-5 py-4">
                                {s.image ? (
                                    <img src={s.image} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                                ) : (
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-ink-muted)]">
                                        {s.username.charAt(0).toUpperCase()}
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate font-medium text-[var(--color-ink)]">{s.username}</span>
                                        {s.twoFactorEnabled && (
                                            <ShieldCheck
                                                className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]"
                                                aria-label={m['server.users.twoFactorOn']()}
                                            />
                                        )}
                                    </div>
                                    <p className="truncate text-xs text-[var(--color-ink-faint)]">{s.email}</p>
                                </div>
                                <span className="hidden text-xs text-[var(--color-ink-muted)] sm:block">
                                    {m['server.users.permissionCount']({ count: s.permissions.length })}
                                </span>
                                <div className="flex items-center gap-1">
                                    {canUpdate && (
                                        <Button variant="ghost" size="icon" aria-label={m['common.actions.edit']()} onClick={() => openEdit(s)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                    {canDelete && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['server.users.remove']()}
                                            className="text-[var(--color-danger)]"
                                            onClick={() => setToDelete(s)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {formOpen && (
                <SubuserFormModal
                    subuser={editSubuser}
                    held={held}
                    onClose={() => setFormOpen(false)}
                    onSaved={() => {
                        setFormOpen(false);
                        qc.invalidateQueries({ queryKey: key });
                    }}
                />
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['server.users.removeTitle']()}
                body={m['server.users.removeBody']({ email: toDelete?.email ?? '' })}
                confirmLabel={m['server.users.remove']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={remove.isPending}
                onConfirm={() => toDelete && remove.mutate(toDelete.uuid)}
            />
        </div>
    );
}
