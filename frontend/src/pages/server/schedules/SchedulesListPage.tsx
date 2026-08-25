import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Play, Trash2, ChevronRight, CircleDot } from 'lucide-react';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { getSchedules, deleteSchedule, triggerSchedule, type Schedule } from '@/api/schedules';
import { timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import ScheduleFormModal from './ScheduleFormModal';
import { cronExpression } from './cron';

export default function SchedulesListPage() {
    const server = useServer();
    const held = server.permissions;
    const canCreate = can(held, 'schedule.create');
    const canUpdate = can(held, 'schedule.update');
    const canDelete = can(held, 'schedule.delete');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['server', server.id, 'schedules'];

    const { data, isLoading, isError } = useQuery({
        queryKey: key,
        queryFn: () => getSchedules(server.uuid),
    });

    const [formOpen, setFormOpen] = useState(false);
    const [toDelete, setToDelete] = useState<Schedule | null>(null);

    const schedules = data ?? [];

    const run = useMutation({
        mutationFn: (id: number) => triggerSchedule(server.uuid, id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.schedules.triggered']() });
            qc.invalidateQueries({ queryKey: key });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const remove = useMutation({
        mutationFn: (id: number) => deleteSchedule(server.uuid, id),
        onSuccess: () => {
            push({ type: 'success', message: m['server.schedules.deleted']() });
            setToDelete(null);
            qc.invalidateQueries({ queryKey: key });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.schedules.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.schedules.subtitle']()}</p>
                </div>
                {canCreate && (
                    <Button onClick={() => setFormOpen(true)}>
                        <Plus className="h-4 w-4" />
                        {m['server.schedules.create']()}
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-14">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : isError ? (
                <p className="py-14 text-center text-sm text-[var(--color-danger)]">{m['server.schedules.loadError']()}</p>
            ) : schedules.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-14 text-center">
                    <CalendarClock className="h-8 w-8 text-[var(--color-ink-faint)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['server.schedules.empty']()}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {schedules.map(s => (
                        <div
                            key={s.id}
                            className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]"
                        >
                            <Link
                                to={`${s.id}`}
                                className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-[var(--color-surface-2)]/40"
                            >
                                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand)]" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate font-medium text-[var(--color-ink)]">{s.name}</span>
                                        <StatusBadge schedule={s} />
                                    </div>
                                    <p className="mt-1 font-mono text-xs text-[var(--color-ink-faint)]">{cronExpression(s.cron)}</p>
                                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                                        {m['server.schedules.taskCount']({ count: s.tasks.length })}
                                        {s.nextRunAt && ` · ${m['server.schedules.nextRun']({ time: timeAgo(s.nextRunAt) })}`}
                                    </p>
                                </div>
                                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                            </Link>
                            <div className="flex items-center gap-1 border-t border-[var(--color-border)] px-3 py-2">
                                {canUpdate && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => run.mutate(s.id)}
                                        disabled={run.isPending || s.isProcessing}
                                    >
                                        <Play className="h-4 w-4" /> {m['server.schedules.runNow']()}
                                    </Button>
                                )}
                                <div className="ml-auto" />
                                {canDelete && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={m['common.actions.delete']()}
                                        className="text-[var(--color-danger)]"
                                        onClick={() => setToDelete(s)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {formOpen && (
                <ScheduleFormModal
                    schedule={null}
                    onClose={() => setFormOpen(false)}
                    onSaved={() => {
                        setFormOpen(false);
                        qc.invalidateQueries({ queryKey: key });
                    }}
                />
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['server.schedules.deleteTitle']()}
                body={m['server.schedules.deleteBody']({ name: toDelete?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={remove.isPending}
                onConfirm={() => toDelete && remove.mutate(toDelete.id)}
            />
        </div>
    );
}

function StatusBadge({ schedule }: { schedule: Schedule }) {
    const [label, cls] = schedule.isProcessing
        ? [m['server.schedules.status.processing'](), 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]']
        : schedule.isActive
          ? [m['server.schedules.status.active'](), 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]']
          : [m['server.schedules.status.inactive'](), 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'];
    return (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
            <CircleDot className="h-2.5 w-2.5" /> {label}
        </span>
    );
}
