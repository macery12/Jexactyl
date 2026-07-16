import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { RotateCcw, X, Trash2, ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { m, td } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { getQueue, cancelQueueItem, retryQueueItem, bulkClearQueue, type DownloadQueueItem } from '@/api/modQueue';
import { queueKey } from './queueKey';

const STATUS_ICON: Record<DownloadQueueItem['status'], typeof Clock> = {
    pending: Clock,
    downloading: Loader2,
    completed: CheckCircle2,
    failed: AlertCircle,
};

const STATUS_COLOR: Record<DownloadQueueItem['status'], string> = {
    pending: 'text-[var(--color-ink-faint)]',
    downloading: 'text-[var(--brand)]',
    completed: 'text-[var(--color-accent)]',
    failed: 'text-[var(--color-danger)]',
};

// Live download queue: polls every 5s, supports cancel / retry / bulk-clear and
// shows modpack child progress + captured install logs.
export function QueueTab({ serverId }: { serverId: string }) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);

    const queueQ = useQuery({
        queryKey: queueKey(serverId),
        queryFn: () => getQueue(serverId),
        refetchInterval: 5_000,
    });

    const invalidate = () => qc.invalidateQueries({ queryKey: queueKey(serverId) });

    const cancel = useMutation({
        mutationFn: (id: string) => cancelQueueItem(serverId, id),
        onSuccess: invalidate,
        onError: err => push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() }),
    });

    const retry = useMutation({
        mutationFn: (id: string) => retryQueueItem(serverId, id),
        onSuccess: invalidate,
        onError: err => push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() }),
    });

    const clear = useMutation({
        mutationFn: (force: boolean) => bulkClearQueue(serverId, undefined, force),
        onSuccess: () => {
            invalidate();
            setConfirmClear(false);
        },
        onError: err => {
            // 409 → active downloads present; surface the force-clear confirm.
            if (isAxiosError(err) && err.response?.status === 409) {
                setConfirmClear(true);
                return;
            }
            push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() });
        },
    });

    const items = queueQ.data ?? [];

    if (queueQ.isLoading) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-16 text-sm text-[var(--color-ink-faint)]">
                <Clock className="h-6 w-6" />
                {m['server.mods.queue.empty']()}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => clear.mutate(false)} disabled={clear.isPending}>
                    <Trash2 className="h-4 w-4" />
                    {m['server.mods.queue.clearFinished']()}
                </Button>
            </div>

            <ul className="flex flex-col gap-2">
                {items.map(item => {
                    const Icon = STATUS_ICON[item.status];
                    const active = item.status === 'pending' || item.status === 'downloading';
                    const isModpack = (item.total_children ?? 0) > 0;
                    const isOpen = expanded === item.uuid;
                    return (
                        <li
                            key={item.uuid}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
                        >
                            <div className="flex items-center gap-3">
                                <Icon
                                    className={`h-4 w-4 shrink-0 ${STATUS_COLOR[item.status]} ${
                                        item.status === 'downloading' ? 'animate-spin' : ''
                                    }`}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-[var(--color-ink)]">
                                        {item.file_name || item.project_id}
                                    </p>
                                    <p className="truncate text-xs text-[var(--color-ink-faint)]">
                                        {td(`server.mods.provider.${item.provider}`, item.provider)}
                                        {' · '}
                                        {td(`server.mods.queue.status.${item.status}`, item.status)}
                                        {isModpack &&
                                            ` · ${m['server.mods.queue.childProgress']({
                                                done: item.completed_children ?? 0,
                                                total: item.total_children ?? 0,
                                            })}`}
                                    </p>
                                    {item.error_message && (
                                        <p className="mt-0.5 truncate text-xs text-[var(--color-danger)]">
                                            {item.error_message}
                                        </p>
                                    )}
                                </div>
                                {item.status === 'failed' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => retry.mutate(item.uuid)}
                                        disabled={retry.isPending}
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                )}
                                {active && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => cancel.mutate(item.uuid)}
                                        disabled={cancel.isPending}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                                {item.install_log && (
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : item.uuid)}
                                        className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                                        aria-label={m['server.mods.queue.log']()}
                                    >
                                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                )}
                            </div>
                            {isModpack && active && (
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                                    <div
                                        className="h-full rounded-full bg-[var(--brand)] transition-all"
                                        style={{
                                            width: `${Math.round(
                                                ((item.completed_children ?? 0) / Math.max(1, item.total_children ?? 1)) * 100,
                                            )}%`,
                                        }}
                                    />
                                </div>
                            )}
                            {isOpen && item.install_log && (
                                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-[var(--color-canvas)] p-2 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                                    {item.install_log}
                                </pre>
                            )}
                        </li>
                    );
                })}
            </ul>

            <ConfirmDialog
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                title={m['server.mods.queue.clearActiveTitle']()}
                body={m['server.mods.queue.clearActiveBody']()}
                confirmLabel={m['server.mods.queue.clearConfirm']()}
                cancelLabel={m['server.mods.filter.clear']()}
                busy={clear.isPending}
                onConfirm={() => clear.mutate(true)}
            />
        </div>
    );
}
