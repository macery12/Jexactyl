import { m, td } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Cpu, MemoryStick, HardDrive, MoreVertical, Pencil, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import {
    type AdminServer,
    suspendServer,
    unsuspendServer,
    reinstallServer,
    deleteServer,
} from '@/api/adminServers';
import { formatMib } from '@/lib/format';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SERVER_STATE } from './serverState';

function StateDot({ server }: { server: AdminServer }) {
    const s = SERVER_STATE[server.state];
    return (
        <span className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-[11px] font-medium text-[var(--color-ink-muted)]">{td(`admin.servers.state.${server.state}`, s.label)}</span>
        </span>
    );
}

function RowActions({ server, onEdit, onDelete }: { server: AdminServer; onEdit: () => void; onDelete: () => void }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const held = useAdminHeld();

    const canUpdate = can(held, 'servers.update');
    const canDelete = can(held, 'servers.delete');
    if (!canUpdate && !canDelete) return null;

    const act = (fn: () => Promise<void>, msg: string) =>
        fn()
            .then(() => {
                push({ type: 'success', message: msg });
                return qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
            })
            .catch(() => push({ type: 'error', message: m['common.states.genericError']() }));

    const suspended = server.state === 'suspended';

    return (
        <Dropdown.Root>
            <Dropdown.Trigger
                aria-label={m['admin.infrastructure.server.actionsLabel']()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:outline-none"
            >
                <MoreVertical className="h-4 w-4" />
            </Dropdown.Trigger>
            <Dropdown.Portal>
                <Dropdown.Content
                    align="end"
                    sideOffset={4}
                    className="z-[60] w-44 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30"
                >
                    {canUpdate && (
                        <>
                            <Item icon={Pencil} label={m['admin.infrastructure.server.edit']()} onSelect={onEdit} />
                            {suspended ? (
                                <Item icon={Power} label={m['admin.infrastructure.server.unsuspend']()} onSelect={() => act(() => unsuspendServer(server.id), m['admin.infrastructure.server.unsuspended']())} />
                            ) : (
                                <Item icon={PowerOff} label={m['admin.infrastructure.server.suspend']()} onSelect={() => act(() => suspendServer(server.id), m['admin.infrastructure.server.suspended']())} />
                            )}
                            <Item icon={RefreshCw} label={m['admin.infrastructure.server.reinstall']()} onSelect={() => act(() => reinstallServer(server.id), m['admin.infrastructure.server.reinstalled']())} />
                        </>
                    )}
                    {canDelete && (
                        <Item icon={Trash2} label={m['common.actions.delete']()} danger onSelect={onDelete} />
                    )}
                </Dropdown.Content>
            </Dropdown.Portal>
        </Dropdown.Root>
    );
}

function Item({ icon: Icon, label, onSelect, danger }: { icon: typeof Pencil; label: string; onSelect: () => void; danger?: boolean }) {
    return (
        <Dropdown.Item
            onSelect={onSelect}
            className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--color-surface-2)] ${
                danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'
            }`}
        >
            <Icon className="h-3.5 w-3.5" /> {label}
        </Dropdown.Item>
    );
}

export function ServersTable({ servers }: { servers: AdminServer[] }) {
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [toDelete, setToDelete] = useState<AdminServer | null>(null);

    const del = useMutation({
        mutationFn: ({ id, force }: { id: number; force: boolean }) => deleteServer(id, force),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.server.deleted']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className="border-b border-[var(--color-border-strong)] text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                        <th className="px-4 py-2.5 font-semibold">{m['admin.servers.table.status']()}</th>
                        <th className="px-4 py-2.5 font-semibold">{m['admin.servers.table.server']()}</th>
                        <th className="hidden px-4 py-2.5 font-semibold md:table-cell">{m['admin.servers.table.node']()}</th>
                        <th className="hidden px-4 py-2.5 font-semibold lg:table-cell">{m['admin.servers.table.owner']()}</th>
                        <th className="px-4 py-2.5 text-right font-semibold">{m['admin.servers.table.limits']()}</th>
                        <th className="w-8 px-4 py-2.5" />
                    </tr>
                </thead>
                <tbody>
                    {servers.map(s => (
                        <tr
                            key={s.id}
                            className="group border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-surface-2)]/40"
                        >
                            <td className="px-4 py-3">
                                <StateDot server={s} />
                            </td>
                            <td className="px-4 py-3">
                                <Link to={`/admin/infrastructure/servers/${s.id}`} className="flex flex-col">
                                    <span className="font-medium text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">{s.name}</span>
                                    <span className="font-mono text-[11px] text-[var(--color-ink-faint)]">{s.identifier}</span>
                                </Link>
                            </td>
                            <td className="hidden px-4 py-3 align-middle md:table-cell">
                                <span className="text-[var(--color-ink-muted)]">{s.nodeName ?? `#${s.nodeId}`}</span>
                            </td>
                            <td className="hidden px-4 py-3 align-middle lg:table-cell">
                                <span className="text-[var(--color-ink-muted)]">{s.ownerName ?? `#${s.ownerId}`}</span>
                            </td>
                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-3 font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                                    <span className="flex items-center gap-1" title={m['admin.servers.table.cpuLimit']()}>
                                        <Cpu className="h-3 w-3 text-[var(--color-ink-faint)]" />
                                        {s.limits.cpu > 0 ? `${s.limits.cpu}%` : '∞'}
                                    </span>
                                    <span className="flex items-center gap-1" title={m['admin.servers.table.memoryLimit']()}>
                                        <MemoryStick className="h-3 w-3 text-[var(--color-ink-faint)]" />
                                        {formatMib(s.limits.memory)}
                                    </span>
                                    <span className="flex items-center gap-1" title={m['admin.servers.table.diskLimit']()}>
                                        <HardDrive className="h-3 w-3 text-[var(--color-ink-faint)]" />
                                        {formatMib(s.limits.disk)}
                                    </span>
                                </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                                <RowActions
                                    server={s}
                                    onEdit={() => navigate(`/admin/infrastructure/servers/${s.id}`)}
                                    onDelete={() => setToDelete(s)}
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.infrastructure.server.deleteTitle']()}
                body={m['admin.infrastructure.server.deleteBody']({ name: toDelete?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                force={{ label: m['admin.infrastructure.server.forceDelete']() }}
                onConfirm={force => toDelete && del.mutate({ id: toDelete.id, force })}
            />
        </div>
    );
}
