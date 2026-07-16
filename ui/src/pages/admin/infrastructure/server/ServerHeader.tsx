import { m, td } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Copy, Check, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import { useServerView } from './ServerContext';
import { Badge } from '@/pages/admin/nodes/NodeBadges';
import { SERVER_STATE } from '@/pages/admin/servers/serverState';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { suspendServer, unsuspendServer, reinstallServer, deleteServer } from '@/api/adminServers';

export function ServerHeader() {
    const server = useServerView();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const held = useAdminHeld();
    const [copied, setCopied] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const canUpdate = can(held, 'servers.update');
    const canDelete = can(held, 'servers.delete');
    const state = SERVER_STATE[server.state];
    const suspended = server.state === 'suspended';

    const copy = () => {
        navigator.clipboard?.writeText(server.uuid).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const [busy, setBusy] = useState(false);

    const run = async (fn: () => Promise<void>, msg: string) => {
        setBusy(true);
        try {
            await fn();
            push({ type: 'success', message: msg });
            await qc.invalidateQueries({ queryKey: ['admin', 'server-view', String(server.id)] });
            await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
        } catch {
            push({ type: 'error', message: m['common.states.genericError']() });
        } finally {
            setBusy(false);
        }
    };

    const del = useMutation({
        mutationFn: (force: boolean) => deleteServer(server.id, force),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.server.deleted']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
            navigate('/admin/infrastructure');
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <Link
                    to="/admin/infrastructure"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                    title={m['admin.infrastructure.title']()}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--color-ink)]">{server.name}</h1>
                        <Badge tone={state.tone}>{td(`admin.servers.state.${server.state}`, state.label)}</Badge>
                    </div>
                    <button
                        onClick={copy}
                        className="group mt-0.5 flex items-center gap-1.5 font-mono text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                    >
                        {server.identifier} · {server.uuid}
                        {copied ? <Check className="h-3 w-3 text-[var(--color-accent)]" /> : <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />}
                    </button>
                </div>
            </div>

            {(canUpdate || canDelete) && (
                <div className="flex shrink-0 items-center gap-2">
                    {canUpdate && (
                        <>
                            {suspended ? (
                                <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => unsuspendServer(server.id), m['admin.infrastructure.server.unsuspended']())}>
                                    <Power className="h-4 w-4" /> {m['admin.infrastructure.server.unsuspend']()}
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => suspendServer(server.id), m['admin.infrastructure.server.suspended']())}>
                                    <PowerOff className="h-4 w-4" /> {m['admin.infrastructure.server.suspend']()}
                                </Button>
                            )}
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => reinstallServer(server.id), m['admin.infrastructure.server.reinstalled']())}>
                                <RefreshCw className="h-4 w-4" /> {m['admin.infrastructure.server.reinstall']()}
                            </Button>
                        </>
                    )}
                    {canDelete && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                        </Button>
                    )}
                    {busy && <Spinner className="h-4 w-4" />}
                </div>
            )}

            <ConfirmDialog
                open={deleting}
                onClose={() => setDeleting(false)}
                title={m['admin.infrastructure.server.deleteTitle']()}
                body={m['admin.infrastructure.server.deleteBody']({ name: server.name })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                force={{ label: m['admin.infrastructure.server.forceDelete']() }}
                onConfirm={force => del.mutate(force)}
            />
        </div>
    );
}
