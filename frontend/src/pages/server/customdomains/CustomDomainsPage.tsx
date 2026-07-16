import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Trash2, Copy, RefreshCw, AlertTriangle } from 'lucide-react';
import { m, td } from '@/i18n';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getCustomDomains,
    syncCustomDomains,
    deleteCustomDomain,
    type CustomDomainMapping,
    type DomainStatus,
} from '@/api/customDomains';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AddDomainModal } from './AddDomainModal';
import { CustomDomainsHelp } from './CustomDomainsHelp';

const STATUS_TOKEN: Record<DomainStatus, string> = {
    active: 'var(--color-accent)',
    pending: 'var(--color-warning)',
    failed: 'var(--color-danger)',
};

function StatusBadge({ status }: { status: DomainStatus }) {
    const token = STATUS_TOKEN[status];
    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: `color-mix(in srgb, ${token} 15%, transparent)`, color: token }}
        >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: token }} />
            {td(`server.customDomains.status.${status}`, status)}
        </span>
    );
}

export default function CustomDomainsPage() {
    const server = useServer();
    const held = server.permissions;
    const canManage = can(held, 'allocation.update');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['server', server.id, 'custom-domains'];

    const { data, isLoading, isError } = useQuery({
        queryKey: key,
        queryFn: () => getCustomDomains(server.uuid),
    });

    const [adding, setAdding] = useState(false);
    const [toDelete, setToDelete] = useState<CustomDomainMapping | null>(null);

    const mappings = data ?? [];
    const primaryPort = server.allocations.find(a => a.isDefault)?.port ?? server.allocations[0]?.port ?? 0;
    const invalidate = () => qc.invalidateQueries({ queryKey: key });

    const sync = useMutation({
        mutationFn: () => syncCustomDomains(server.uuid),
        onSuccess: () => {
            push({ type: 'success', message: m['server.customDomains.syncQueued']() });
            invalidate();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const remove = useMutation({
        mutationFn: (id: number) => deleteCustomDomain(server.uuid, id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.customDomains.deleted']() });
            setToDelete(null);
            invalidate();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            push({ type: 'success', message: m['server.customDomains.copied']() });
        } catch {
            push({ type: 'error', message: m['common.states.genericError']() });
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.customDomains.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.customDomains.subtitle']()}</p>
                </div>
                <div className="flex items-center gap-2">
                    <CustomDomainsHelp />
                    {canManage && (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => sync.mutate()}
                                disabled={sync.isPending || mappings.length === 0}
                            >
                                {sync.isPending ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                                {m['server.customDomains.resync']()}
                            </Button>
                            <Button onClick={() => setAdding(true)}>
                                <Plus className="h-4 w-4" />
                                {m['server.customDomains.add.action']()}
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                        {m['server.customDomains.loadError']()}
                    </p>
                ) : mappings.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Globe className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['server.customDomains.empty']()}</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {mappings.map(row => (
                            <li key={row.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-sm text-[var(--color-ink)]">{row.fullDomain}</span>
                                        <StatusBadge status={row.status} />
                                        <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                                            {td(`server.customDomains.recordType.${row.recordType}`, row.recordType)}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                                        {m['server.customDomains.connectVia']({ address: `${row.fullDomain}:${row.port}` })}
                                    </p>
                                    {row.status === 'failed' && row.lastError && (
                                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--color-danger)]">
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                            <span className="min-w-0">{row.lastError}</span>
                                        </p>
                                    )}
                                    {row.lastSyncedAt && (
                                        <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                                            {m['server.customDomains.lastSynced']({
                                                time: new Date(row.lastSyncedAt).toLocaleString(),
                                            })}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={m['server.customDomains.copy']()}
                                        onClick={() => copy(row.fullDomain)}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                    {canManage && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['common.actions.delete']()}
                                            className="text-[var(--color-danger)]"
                                            onClick={() => setToDelete(row)}
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

            {adding && (
                <AddDomainModal
                    uuid={server.uuid}
                    port={primaryPort}
                    onClose={() => setAdding(false)}
                    onSaved={() => setAdding(false)}
                />
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['server.customDomains.deleteTitle']()}
                body={m['server.customDomains.deleteBody']({ domain: toDelete?.fullDomain ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={remove.isPending}
                onConfirm={() => toDelete && remove.mutate(toDelete.id)}
            />
        </div>
    );
}
