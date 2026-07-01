import { m } from '@/i18n';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Network, Plus, Trash2 } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useNode } from '../NodeContext';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { getNodeAllocations, createAllocations, deleteAllocation, type NodeAllocation, type AllocationFormValues } from '@/api/nodes';

interface AddForm {
    ip: string;
    alias: string;
    start_port: number;
    end_port: number | '';
}

export function NodeAllocationsTab() {
    const node = useNode();
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const held = useAdminHeld();
    const canManage = can(held, 'nodes.update');
    const [toDelete, setToDelete] = useState<NodeAllocation | null>(null);

    const { data: allocations, isLoading } = useQuery({
        queryKey: ['admin', 'node-allocations', node.id],
        queryFn: () => getNodeAllocations(node.id),
    });

    const assigned = allocations?.filter(a => a.isAssigned).length ?? 0;
    const total = allocations?.length ?? 0;
    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'node-allocations', node.id] });

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<AddForm>({ defaultValues: { ip: '0.0.0.0', alias: '', start_port: 25565, end_port: '' } });

    const add = useMutation({
        mutationFn: (v: AddForm) => {
            const payload: AllocationFormValues = {
                ip: v.ip,
                alias: v.alias || null,
                start_port: Number(v.start_port),
                end_port: v.end_port === '' ? null : Number(v.end_port),
            };
            return createAllocations(node.id, payload);
        },
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.alloc.added']() });
            await invalidate();
            reset({ ip: '0.0.0.0', alias: '', start_port: 25565, end_port: '' });
        },
        onError: err =>
            push({ type: 'error', message: (isAxiosError(err) && err.response?.data?.message) || m['common.states.genericError']() }),
    });

    const del = useMutation({
        mutationFn: (id: number) => deleteAllocation(node.id, id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.alloc.deleted']() });
            await invalidate();
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const req = { required: m['admin.infrastructure.common.required']() };

    return (
        <Panel
            title={m['admin.nodes.allocationsTab.title']()}
            icon={Network}
            right={
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    {m['admin.nodes.allocationsTab.assigned']({ assigned, total })}
                </span>
            }
            bodyClassName="max-h-[36rem] overflow-y-auto"
        >
            {canManage && (
                <form
                    onSubmit={handleSubmit(v => add.mutate(v))}
                    className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 sm:grid-cols-5"
                >
                    <Input className="h-9" placeholder={m['admin.infrastructure.alloc.ip']()} invalid={!!errors.ip} {...register('ip', req)} />
                    <Input className="h-9" placeholder={m['admin.infrastructure.alloc.alias']()} {...register('alias')} />
                    <Input className="h-9" type="number" placeholder={m['admin.infrastructure.alloc.startPort']()} {...register('start_port', { valueAsNumber: true, ...req })} />
                    <Input className="h-9" type="number" placeholder={m['admin.infrastructure.alloc.endPort']()} {...register('end_port')} />
                    <Button type="submit" size="sm" disabled={add.isPending}>
                        {add.isPending ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        {m['admin.infrastructure.alloc.add']()}
                    </Button>
                </form>
            )}

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : !allocations || allocations.length === 0 ? (
                <p className="py-6 text-sm text-[var(--color-ink-faint)]">{m['admin.nodes.allocationsTab.none']()}</p>
            ) : (
                <div className="flex flex-col">
                    {allocations.map(a => (
                        <div
                            key={a.id}
                            className="group flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 last:border-0"
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.isAssigned ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-ink-faint)]'}`}
                                />
                                <span className="font-mono text-xs tabular-nums text-[var(--color-ink)]">
                                    {a.alias || a.ip}:{a.port}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="truncate font-mono text-[11px] text-[var(--color-ink-faint)]">
                                    {a.isAssigned ? (a.serverName ?? m['admin.nodes.allocationsTab.assignedLabel']()) : m['admin.nodes.allocationsTab.free']()}
                                </span>
                                {canManage && !a.isAssigned && (
                                    <button
                                        onClick={() => setToDelete(a)}
                                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.infrastructure.alloc.deleteTitle']()}
                body={m['admin.infrastructure.alloc.deleteBody']({ ip: toDelete?.ip ?? '', port: toDelete?.port ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.id)}
            />
        </Panel>
    );
}
