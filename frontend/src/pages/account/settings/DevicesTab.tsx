import { m } from '@/i18n/messages';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone, ChevronDown, ChevronRight } from 'lucide-react';
import {
    getSessions,
    getSessionHistory,
    revokeSession,
    revokeAllSessions,
    updateSessionLabel,
} from '@/api/sessions';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SettingsCard } from './SettingsCard';
import { SessionCard } from './SessionCard';

const SESSIONS_KEY = ['account', 'sessions'];
const HISTORY_KEY = ['account', 'sessions', 'history'];

// "Devices" tab: active sessions with per-device rename/revoke, a sign-out-all
// action, and a collapsible history of recently revoked sessions.
export function DevicesTab() {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);

    const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
    const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);

    const { data: sessions, isLoading } = useQuery({ queryKey: SESSIONS_KEY, queryFn: getSessions });

    const { data: history, isLoading: historyLoading } = useQuery({
        queryKey: HISTORY_KEY,
        queryFn: getSessionHistory,
        enabled: showHistory,
    });

    const revoke = useMutation({
        mutationFn: (id: string) => revokeSession(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: SESSIONS_KEY });
            qc.invalidateQueries({ queryKey: HISTORY_KEY });
            push({ type: 'success', message: m['account.devices.revokeSuccess']() });
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
        onSettled: () => setConfirmRevoke(null),
    });

    const revokeAll = useMutation({
        mutationFn: () => revokeAllSessions(false),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: SESSIONS_KEY });
            qc.invalidateQueries({ queryKey: HISTORY_KEY });
            push({ type: 'success', message: m['account.devices.revokeAllSuccess']() });
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
        onSettled: () => setConfirmRevokeAll(false),
    });

    const rename = useMutation({
        mutationFn: ({ id, label }: { id: string; label: string | null }) => updateSessionLabel(id, label),
        onMutate: ({ id }) => setRenamingId(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: SESSIONS_KEY }),
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
        onSettled: () => setRenamingId(null),
    });

    const otherCount = (sessions ?? []).filter(s => !s.isCurrent).length;

    return (
        <div className="flex flex-col gap-6">
            <SettingsCard
                title={m['account.devices.title']()}
                description={m['account.devices.description']()}
                icon={MonitorSmartphone}
                right={
                    otherCount > 0 ? (
                        <Button variant="outline" size="sm" onClick={() => setConfirmRevokeAll(true)}>
                            {m['account.devices.revokeAll']()}
                        </Button>
                    ) : undefined
                }
            >
                {isLoading ? (
                    <div className="flex justify-center py-4">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : sessions && sessions.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {sessions.map(s => (
                            <SessionCard
                                key={s.id}
                                session={s}
                                renaming={renamingId === s.id}
                                onRename={label => rename.mutate({ id: s.id, label })}
                                onRevoke={() => setConfirmRevoke(s.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['account.devices.empty']()}</p>
                )}

                <div className="mt-5 border-t border-[var(--color-border)] pt-4">
                    <button
                        type="button"
                        onClick={() => setShowHistory(v => !v)}
                        className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    >
                        {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {m['account.devices.historyTitle']()}
                    </button>

                    {showHistory && (
                        <div className="mt-3">
                            {historyLoading ? (
                                <div className="flex justify-center py-3">
                                    <Spinner className="h-5 w-5" />
                                </div>
                            ) : history && history.length > 0 ? (
                                <div className="flex flex-col gap-3">
                                    {history.map(s => (
                                        <SessionCard key={s.id} session={s} revoked />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-[var(--color-ink-muted)]">{m['account.devices.historyEmpty']()}</p>
                            )}
                        </div>
                    )}
                </div>
            </SettingsCard>

            <ConfirmDialog
                open={confirmRevoke !== null}
                onClose={() => setConfirmRevoke(null)}
                title={m['account.devices.revokeConfirmTitle']()}
                body={m['account.devices.revokeConfirmBody']()}
                confirmLabel={m['account.devices.revoke']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={revoke.isPending}
                onConfirm={() => confirmRevoke && revoke.mutate(confirmRevoke)}
            />

            <ConfirmDialog
                open={confirmRevokeAll}
                onClose={() => setConfirmRevokeAll(false)}
                title={m['account.devices.revokeAllConfirmTitle']()}
                body={m['account.devices.revokeAllConfirmBody']()}
                confirmLabel={m['account.devices.revokeAll']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={revokeAll.isPending}
                onConfirm={() => revokeAll.mutate()}
            />
        </div>
    );
}
