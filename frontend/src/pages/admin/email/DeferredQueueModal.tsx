import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpToLine, Clock, RotateCw, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { cn } from '@/lib/cn';
import { getDeferredQueue, sendDeferredNow, cancelDeferred } from '@/api/email';

const DEFERRED_QUEUE_KEY = ['admin', 'email', 'deferred'] as const;

// Deferred-email queue as a modal (replaces V1's full-page tab). Shows the
// queue stats, the pending list, and per-row "move to front" / "cancel".
export function DeferredQueueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [busyId, setBusyId] = useState<{ id: number; action: 'send' | 'cancel' } | null>(null);

    const queueQ = useQuery({
        queryKey: DEFERRED_QUEUE_KEY,
        queryFn: () => getDeferredQueue(),
        enabled: open,
    });

    const refresh = () => qc.invalidateQueries({ queryKey: DEFERRED_QUEUE_KEY });

    const sendMut = useMutation({
        mutationFn: (id: number) => sendDeferredNow(id),
        onMutate: id => setBusyId({ id, action: 'send' }),
        onSuccess: () => {
            push({ type: 'success', message: m['admin.email.deferred.sentNow']() });
            refresh();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['admin.email.deferred.sendError']() }),
        onSettled: () => setBusyId(null),
    });

    const cancelMut = useMutation({
        mutationFn: (id: number) => cancelDeferred(id),
        onMutate: id => setBusyId({ id, action: 'cancel' }),
        onSuccess: () => {
            push({ type: 'success', message: m['admin.email.deferred.cancelled']() });
            refresh();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['admin.email.deferred.cancelError']() }),
        onSettled: () => setBusyId(null),
    });

    const data = queueQ.data;
    const rows = data?.deferred.data ?? [];
    const isDue = (scheduledAt: string) => new Date(scheduledAt) <= new Date();
    const fmt = (d: string) => new Date(d).toLocaleString();

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['admin.email.deferred.title']()}
            description={m['admin.email.deferred.subtitle']()}
            size="lg"
            footer={
                <Button variant="ghost" size="sm" onClick={onClose}>
                    {m['common.actions.close']()}
                </Button>
            }
        >
            <div className="flex flex-col gap-4">
                {/* Stats */}
                <div className="flex flex-wrap items-center gap-3">
                    <Stat label={m['admin.email.deferred.totalQueued']()} value={String(data?.stats.total_queued ?? 0)} />
                    <Stat
                        label={m['admin.email.deferred.dueNow']()}
                        value={String(data?.stats.due_now ?? 0)}
                        warn={(data?.stats.due_now ?? 0) > 0}
                    />
                    <Stat
                        label={m['admin.email.deferred.nextSend']()}
                        value={data?.stats.next_send_time ? fmt(data.stats.next_send_time) : '—'}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={refresh}
                        disabled={queueQ.isFetching}
                    >
                        <RotateCw className={cn('h-4 w-4', queueQ.isFetching && 'animate-spin')} />
                        {m['admin.email.deferred.refresh']()}
                    </Button>
                </div>

                {/* List */}
                {queueQ.isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Spinner className="h-6 w-6" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-12 text-center">
                        <Clock className="h-7 w-7 text-[var(--color-ink-faint)]" />
                        <p className="text-sm font-medium text-[var(--color-ink)]">{m['admin.email.deferred.emptyTitle']()}</p>
                        <p className="text-xs text-[var(--color-ink-muted)]">{m['admin.email.deferred.emptyBody']()}</p>
                    </div>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {rows.map(email => {
                            const due = isDue(email.scheduled_at);
                            const busy = busyId?.id === email.id;
                            return (
                                <li
                                    key={email.id}
                                    className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 px-4 py-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium text-[var(--color-ink)]">
                                                {email.recipient}
                                            </span>
                                            {email.user && (
                                                <span className="text-xs text-[var(--color-ink-faint)]">
                                                    @{email.user.username}
                                                </span>
                                            )}
                                            {due && (
                                                <span className="rounded-full bg-[var(--color-warning)]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-warning)]">
                                                    {m['admin.email.deferred.due']()}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                                            <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-muted)]">
                                                {email.template_key}
                                            </code>
                                            <span>{email.reason.replace(/_/g, ' ')}</span>
                                            <span className={due ? 'text-[var(--color-warning)]' : undefined}>
                                                {fmt(email.scheduled_at)}
                                            </span>
                                            <span>{m['admin.email.deferred.attempts']({ count: email.attempts })}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => sendMut.mutate(email.id)}
                                            disabled={busy}
                                        >
                                            {busy && busyId?.action === 'send' ? (
                                                <Spinner className="h-4 w-4" />
                                            ) : (
                                                <ArrowUpToLine className="h-4 w-4" />
                                            )}
                                            {m['admin.email.deferred.moveToFront']()}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => cancelMut.mutate(email.id)}
                                            disabled={busy}
                                        >
                                            {busy && busyId?.action === 'cancel' ? (
                                                <Spinner className="h-4 w-4" />
                                            ) : (
                                                <X className="h-4 w-4" />
                                            )}
                                            {m['common.actions.cancel']()}
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </Modal>
    );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
    return (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</p>
            <p
                className={cn(
                    'text-sm font-semibold',
                    warn ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink)]',
                )}
            >
                {value}
            </p>
        </div>
    );
}
