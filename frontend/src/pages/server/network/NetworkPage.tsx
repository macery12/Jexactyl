import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, Star, Trash2, Pencil } from 'lucide-react';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import {
    getAllocations,
    createAllocation,
    setPrimaryAllocation,
    setAllocationNotes,
    deleteAllocation,
    type Allocation,
} from '@/api/allocations';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { Field } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function NetworkPage() {
    const server = useServer();
    const held = server.permissions;
    const canCreate = can(held, 'allocation.create');
    const canUpdate = can(held, 'allocation.update');
    const canDelete = can(held, 'allocation.delete');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['server', server.id, 'allocations'];

    const { data, isLoading, isError } = useQuery({
        queryKey: key,
        queryFn: () => getAllocations(server.uuid),
    });

    const [editNotes, setEditNotes] = useState<Allocation | null>(null);
    const [toDelete, setToDelete] = useState<Allocation | null>(null);

    const allocations = data ?? [];
    const limit = server.featureLimits.allocations;
    // A limit of 0 means unlimited (matches V1's feature-limit semantics).
    const atLimit = limit > 0 && allocations.length >= limit;

    const invalidate = () => qc.invalidateQueries({ queryKey: key });

    const create = useMutation({
        mutationFn: () => createAllocation(server.uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.network.created']() });
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const primary = useMutation({
        mutationFn: (id: number) => setPrimaryAllocation(server.uuid, id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.network.primarySet']() });
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const remove = useMutation({
        mutationFn: (id: number) => deleteAllocation(server.uuid, id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.network.deleted']() });
            setToDelete(null);
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.network.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.network.subtitle']()}</p>
                </div>
                {canCreate && (
                    <div className="flex flex-col items-end gap-1">
                        <Button onClick={() => create.mutate()} disabled={atLimit || create.isPending}>
                            {create.isPending ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                            {m['server.network.addAllocation']()}
                        </Button>
                        {limit > 0 && (
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {m['server.network.limit']({ used: allocations.length, total: limit })}
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['server.network.loadError']()}</p>
                ) : allocations.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Network className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['server.network.empty']()}</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {allocations.map(a => (
                            <li key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm text-[var(--color-ink)]">
                                            {a.alias || a.ip}:{a.port}
                                        </span>
                                        {a.isDefault && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
                                                <Star className="h-3 w-3" /> {m['server.network.primary']()}
                                            </span>
                                        )}
                                    </div>
                                    {a.alias && (
                                        <p className="mt-0.5 font-mono text-xs text-[var(--color-ink-faint)]">
                                            {a.ip}:{a.port}
                                        </p>
                                    )}
                                    <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">
                                        {a.notes || m['server.network.noNotes']()}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    {canUpdate && !a.isDefault && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => primary.mutate(a.id)}
                                            disabled={primary.isPending}
                                        >
                                            <Star className="h-4 w-4" /> {m['server.network.makePrimary']()}
                                        </Button>
                                    )}
                                    {canUpdate && (
                                        <Button variant="ghost" size="icon" aria-label={m['server.network.editNotes']()} onClick={() => setEditNotes(a)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                    {canDelete && !a.isDefault && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['common.actions.delete']()}
                                            className="text-[var(--color-danger)]"
                                            onClick={() => setToDelete(a)}
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

            {editNotes && (
                <NotesModal
                    uuid={server.uuid}
                    allocation={editNotes}
                    onClose={() => setEditNotes(null)}
                    onSaved={() => {
                        setEditNotes(null);
                        invalidate();
                    }}
                />
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['server.network.deleteTitle']()}
                body={m['server.network.deleteBody']({ address: toDelete ? `${toDelete.ip}:${toDelete.port}` : '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={remove.isPending}
                onConfirm={() => toDelete && remove.mutate(toDelete.id)}
            />
        </div>
    );
}

function NotesModal({
    uuid,
    allocation,
    onClose,
    onSaved,
}: {
    uuid: string;
    allocation: Allocation;
    onClose: () => void;
    onSaved: () => void;
}) {
    const push = useFlashes(s => s.push);
    const [notes, setNotes] = useState(allocation.notes ?? '');

    const save = useMutation({
        mutationFn: () => setAllocationNotes(uuid, allocation.id, notes.trim() || null),
        onSuccess: () => {
            push({ type: 'success', message: m['server.network.notesSaved']() });
            onSaved();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.network.editNotes']()}
            description={`${allocation.ip}:${allocation.port}`}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <Field label={m['server.network.notes']()} htmlFor="allocation-notes">
                <Textarea
                    id="allocation-notes"
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={m['server.network.notesPlaceholder']()}
                />
            </Field>
        </Modal>
    );
}
