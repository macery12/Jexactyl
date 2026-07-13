import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, RefreshCw, UserCheck } from 'lucide-react';
import { m, td } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getJGuardPending,
    approveJGuardUser,
    rejectJGuardUser,
    type JGuardPendingUser,
} from '@/api/adminAuth';

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Relative "time until" for delayed-mode expiry (future timestamp).
function timeRemaining(iso: string): { label: string; tone: string } {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return { label: m['admin.auth.pending.activating'](), tone: 'text-[var(--color-accent)]' };
    const mins = Math.round(diff / 60000);
    const label =
        mins < 60
            ? m['admin.auth.jguard.delayMinutes']({ count: mins })
            : mins % 60 === 0
              ? m['admin.auth.jguard.delayHours']({ count: mins / 60 })
              : m['admin.auth.jguard.delayMixed']({ hours: Math.floor(mins / 60), minutes: mins % 60 });
    return { label: m['admin.auth.pending.inTime']({ time: label }), tone: 'text-[var(--color-warning)]' };
}

type Pending = { userId: number; action: 'approve' | 'reject' };

export default function JGuardPendingPage() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [confirm, setConfirm] = useState<Pending | null>(null);
    // Tick every 30s so relative expiry times stay fresh without a refetch.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(id);
    }, []);

    const { data, isLoading, isFetching, refetch } = useQuery({
        queryKey: ['admin', 'jguard', 'pending'],
        queryFn: () => getJGuardPending('pending'),
    });
    const entries = data ?? [];

    const mutation = useMutation({
        mutationFn: ({ userId, action }: Pending) =>
            action === 'approve' ? approveJGuardUser(userId) : rejectJGuardUser(userId),
        onSuccess: (_res, vars) => {
            qc.setQueryData<JGuardPendingUser[]>(['admin', 'jguard', 'pending'], prev =>
                (prev ?? []).filter(e => e.user_id !== vars.userId),
            );
            push({
                type: 'success',
                message: vars.action === 'approve' ? m['admin.auth.pending.approved']() : m['admin.auth.pending.rejected'](),
            });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    return (
        <div className="flex flex-col gap-5">
            <ConfirmDialog
                open={confirm !== null}
                onClose={() => setConfirm(null)}
                title={confirm?.action === 'approve' ? m['admin.auth.pending.approveTitle']() : m['admin.auth.pending.rejectTitle']()}
                body={confirm?.action === 'approve' ? m['admin.auth.pending.approveBody']() : m['admin.auth.pending.rejectBody']()}
                confirmLabel={confirm?.action === 'approve' ? m['admin.auth.pending.approve']() : m['admin.auth.pending.reject']()}
                cancelLabel={m['common.actions.cancel']()}
                danger={confirm?.action === 'reject'}
                busy={mutation.isPending}
                onConfirm={() => {
                    if (confirm) mutation.mutate(confirm, { onSettled: () => setConfirm(null) });
                }}
            />

            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.auth.pending.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {isLoading ? m['common.states.loading']() : m['admin.auth.pending.count']({ count: entries.length })}
                    </p>
                </div>
                <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
                    <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                    {m['common.actions.refresh']()}
                </Button>
            </header>

            {isLoading ? (
                <div className="flex justify-center py-12">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : entries.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border-strong)] py-14 text-center">
                    <UserCheck className="h-8 w-8 text-[var(--color-ink-faint)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.auth.pending.empty']()}</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-2xl border border-[var(--color-border-strong)]">
                    <table className="w-full min-w-[52rem] text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                                <th className="px-4 py-3 font-medium">{m['admin.auth.pending.colUsername']()}</th>
                                <th className="px-4 py-3 font-medium">{m['admin.auth.pending.colEmail']()}</th>
                                <th className="px-4 py-3 font-medium">{m['admin.auth.pending.colMode']()}</th>
                                <th className="px-4 py-3 font-medium">{m['admin.auth.pending.colRegistered']()}</th>
                                <th className="px-4 py-3 font-medium">{m['admin.auth.pending.colRemaining']()}</th>
                                <th className="px-4 py-3 text-right font-medium">{m['admin.auth.pending.colActions']()}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map(entry => {
                                const remaining = entry.expires_at ? timeRemaining(entry.expires_at) : null;
                                const busy = mutation.isPending && mutation.variables?.userId === entry.user_id;
                                return (
                                    <tr key={entry.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/40">
                                        <td className="px-4 py-3 font-medium text-[var(--color-ink)]">{entry.username}</td>
                                        <td className="px-4 py-3 text-[var(--color-ink-muted)]">{entry.email}</td>
                                        <td className="px-4 py-3">
                                            <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs capitalize text-[var(--color-ink-muted)]">
                                                {td(`admin.auth.jguard.mode.${entry.approval_mode}`, entry.approval_mode)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">{formatDate(entry.created_at)}</td>
                                        <td className="px-4 py-3 text-xs">
                                            {remaining ? (
                                                <span className={remaining.tone}>{remaining.label}</span>
                                            ) : (
                                                <span className="italic text-[var(--color-ink-faint)]">
                                                    {m['admin.auth.pending.awaitingManual']()}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button size="sm" disabled={busy} onClick={() => setConfirm({ userId: entry.user_id, action: 'approve' })}>
                                                    <Check className="h-3.5 w-3.5" />
                                                    {m['admin.auth.pending.approve']()}
                                                </Button>
                                                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm({ userId: entry.user_id, action: 'reject' })}>
                                                    <X className="h-3.5 w-3.5" />
                                                    {m['admin.auth.pending.reject']()}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
