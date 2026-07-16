import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Pencil,
    Plus,
    Trash2,
    Terminal,
    Power,
    Archive,
    Clock,
} from 'lucide-react';
import { m, td } from '@/i18n';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { getSchedule, deleteTask, type Task } from '@/api/schedules';
import { timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import ScheduleFormModal from './ScheduleFormModal';
import TaskFormModal from './TaskFormModal';
import { cronExpression } from './cron';

const ACTION_ICON = { power: Power, command: Terminal, backup: Archive } as const;

export default function ScheduleDetailPage() {
    const server = useServer();
    const held = server.permissions;
    const canUpdate = can(held, 'schedule.update');

    const { scheduleId } = useParams();
    const id = Number(scheduleId);

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['server', server.id, 'schedule', id];

    const { data: schedule, isLoading, isError } = useQuery({
        queryKey: key,
        queryFn: () => getSchedule(server.uuid, id),
        enabled: !Number.isNaN(id),
    });

    const [editSchedule, setEditSchedule] = useState(false);
    const [taskForm, setTaskForm] = useState<{ task: Task | null } | null>(null);
    const [toDelete, setToDelete] = useState<Task | null>(null);

    const removeTask = useMutation({
        mutationFn: (taskId: number) => deleteTask(server.uuid, id, taskId),
        onSuccess: () => {
            push({ type: 'success', message: m['server.schedules.taskDeleted']() });
            setToDelete(null);
            qc.invalidateQueries({ queryKey: key });
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }
    if (isError || !schedule) {
        return <p className="py-16 text-center text-sm text-[var(--color-danger)]">{m['server.schedules.loadError']()}</p>;
    }

    const refetch = () => qc.invalidateQueries({ queryKey: key });

    return (
        <div className="flex flex-col gap-6">
            <div>
                <Link to=".." className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]">
                    <ArrowLeft className="h-4 w-4" /> {m['server.schedules.backToList']()}
                </Link>
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-[var(--color-ink)]">{schedule.name}</h1>
                        <p className="mt-1 font-mono text-xs text-[var(--color-ink-faint)]">{cronExpression(schedule.cron)}</p>
                    </div>
                    {canUpdate && (
                        <Button variant="outline" size="sm" onClick={() => setEditSchedule(true)}>
                            <Pencil className="h-4 w-4" /> {m['server.schedules.editSchedule']()}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={m['server.schedules.status.label']()} value={schedule.isActive ? m['server.schedules.status.active']() : m['server.schedules.status.inactive']()} />
                <Stat label={m['server.schedules.onlyOnlineLabel']()} value={schedule.onlyWhenOnline ? m['common.states.yes']() : m['common.states.no']()} />
                <Stat label={m['server.schedules.lastRun']()} value={schedule.lastRunAt ? timeAgo(schedule.lastRunAt) : m['server.schedules.never']()} />
                <Stat label={m['server.schedules.nextRunLabel']()} value={schedule.nextRunAt ? timeAgo(schedule.nextRunAt) : '—'} />
            </div>

            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['server.schedules.tasksTitle']()}</h2>
                {canUpdate && (
                    <Button size="sm" onClick={() => setTaskForm({ task: null })}>
                        <Plus className="h-4 w-4" /> {m['server.schedules.addTask']()}
                    </Button>
                )}
            </div>

            {schedule.tasks.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-12 text-center">
                    <Clock className="h-8 w-8 text-[var(--color-ink-faint)]" />
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['server.schedules.noTasks']()}</p>
                </div>
            ) : (
                <ol className="flex flex-col gap-3">
                    {schedule.tasks.map((task, index) => {
                        const Icon = ACTION_ICON[task.action as keyof typeof ACTION_ICON] ?? Terminal;
                        return (
                            <li
                                key={task.id}
                                className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-4"
                            >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-ink-muted)]">
                                    {index + 1}
                                </span>
                                <Icon className="h-5 w-5 shrink-0 text-[var(--brand)]" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium capitalize text-[var(--color-ink)]">
                                        {td(`server.schedules.action.${task.action}`, task.action)}
                                    </p>
                                    {task.payload && (
                                        <p className="truncate font-mono text-xs text-[var(--color-ink-faint)]">{task.payload}</p>
                                    )}
                                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                                        {m['server.schedules.timeOffsetLabel']({ seconds: task.timeOffset })}
                                        {task.continueOnFailure && ` · ${m['server.schedules.continueOnFailureShort']()}`}
                                    </p>
                                </div>
                                {canUpdate && (
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" aria-label={m['common.actions.edit']()} onClick={() => setTaskForm({ task })}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['common.actions.delete']()}
                                            className="text-[var(--color-danger)]"
                                            onClick={() => setToDelete(task)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}

            {editSchedule && (
                <ScheduleFormModal
                    schedule={schedule}
                    onClose={() => setEditSchedule(false)}
                    onSaved={() => {
                        setEditSchedule(false);
                        refetch();
                    }}
                />
            )}

            {taskForm && (
                <TaskFormModal
                    scheduleId={id}
                    task={taskForm.task}
                    onClose={() => setTaskForm(null)}
                    onSaved={() => {
                        setTaskForm(null);
                        refetch();
                    }}
                />
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['server.schedules.deleteTaskTitle']()}
                body={m['server.schedules.deleteTaskBody']()}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={removeTask.isPending}
                onConfirm={() => toDelete && removeTask.mutate(toDelete.id)}
            />
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs text-[var(--color-ink-faint)]">{label}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-[var(--color-ink)]">{value}</p>
        </div>
    );
}
