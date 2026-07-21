import { m } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ChevronLeft, Copy, Check, Wrench, Globe, Lock, Pencil, Trash2 } from 'lucide-react';
import { useNode } from './NodeContext';
import { Badge, SuperchargedBadge } from './NodeBadges';
import { cn } from '@/lib/cn';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { deleteNode } from '@/api/nodes';

export function NodeHeader() {
    const node = useNode();
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const held = useAdminHeld();
    const [copied, setCopied] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const address = `${node.scheme}://${node.fqdn}:${node.ports.httpPublic}`;

    const copy = () => {
        navigator.clipboard?.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const del = useMutation({
        mutationFn: () => deleteNode(node.id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.node.deleted']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
            navigate('/admin/infrastructure');
        },
        onError: err =>
            push({
                type: 'error',
                message: (isAxiosError(err) && err.response?.data?.message) || m['common.states.genericError'](),
            }),
    });

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <Link
                    to="/admin/infrastructure"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                    title={m['admin.nodes.backToNodes']()}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--color-ink)]">{node.name}</h1>
                        <SuperchargedBadge wingsType={node.wingsType} />
                        {node.maintenanceMode && (
                            <Badge tone="warning">
                                <Wrench className="h-2.5 w-2.5" /> {m['admin.nodes.maintenance']()}
                            </Badge>
                        )}
                        <Badge tone="muted">
                            {node.isPublic ? <Globe className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                            {node.isPublic ? m['admin.nodes.public']() : m['admin.nodes.private']()}
                        </Badge>
                    </div>
                    <button
                        onClick={copy}
                        className="group mt-0.5 flex items-center gap-1.5 font-mono text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                    >
                        {address}
                        {copied ? (
                            <Check className="h-3 w-3 text-[var(--color-accent)]" />
                        ) : (
                            <Copy className={cn('h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100')} />
                        )}
                    </button>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {can(held, 'nodes.update') && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/admin/infrastructure/nodes/${node.id}/edit`)}>
                        <Pencil className="h-4 w-4" /> {m['admin.infrastructure.server.edit']()}
                    </Button>
                )}
                {can(held, 'nodes.delete') && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
                        <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                    </Button>
                )}
            </div>

            <ConfirmDialog
                open={deleting}
                onClose={() => setDeleting(false)}
                title={m['admin.infrastructure.node.deleteTitle']()}
                body={m['admin.infrastructure.node.deleteBody']({ name: node.name })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                onConfirm={() => del.mutate()}
            />
        </div>
    );
}
