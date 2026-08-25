import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { m } from '@/i18n/messages';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { saveTask, type Task } from '@/api/schedules';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';

type Action = 'command' | 'power' | 'backup';
const POWER_SIGNALS = ['start', 'restart', 'stop', 'kill'];

export default function TaskFormModal({
    scheduleId,
    task,
    onClose,
    onSaved,
}: {
    scheduleId: number;
    task: Task | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const isEdit = !!task;

    const [action, setAction] = useState<Action>((task?.action as Action) ?? 'command');
    const [payload, setPayload] = useState(task?.payload ?? '');
    const [timeOffset, setTimeOffset] = useState(String(task?.timeOffset ?? 0));
    const [continueOnFailure, setContinueOnFailure] = useState(task?.continueOnFailure ?? false);

    const actionOptions = [
        { value: 'command', label: m['server.schedules.action.command']() },
        { value: 'power', label: m['server.schedules.action.power']() },
        { value: 'backup', label: m['server.schedules.action.backup']() },
    ];
    const powerOptions = POWER_SIGNALS.map(s => ({ value: s, label: s }));

    const changeAction = (next: string) => {
        setAction(next as Action);
        // Reset payload when switching to/from power (its payload is a fixed signal).
        setPayload(next === 'power' ? 'start' : '');
    };

    const save = useMutation({
        mutationFn: () =>
            saveTask(server.uuid, scheduleId, {
                id: task?.id,
                action,
                payload,
                timeOffset: Number(timeOffset) || 0,
                continueOnFailure,
            }),
        onSuccess: () => {
            push({ type: 'success', message: isEdit ? m['server.schedules.taskUpdated']() : m['server.schedules.taskCreated']() });
            onSaved();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={isEdit ? m['server.schedules.editTaskTitle']() : m['server.schedules.addTaskTitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <Field label={m['server.schedules.actionLabel']()}>
                    <Select value={action} onChange={changeAction} options={actionOptions} />
                </Field>

                {action === 'power' ? (
                    <Field label={m['server.schedules.signalLabel']()}>
                        <Select value={payload || 'start'} onChange={setPayload} options={powerOptions} />
                    </Field>
                ) : action === 'command' ? (
                    <Field label={m['server.schedules.commandLabel']()} htmlFor="task-command">
                        <Textarea
                            id="task-command"
                            rows={2}
                            value={payload}
                            onChange={e => setPayload(e.target.value)}
                            placeholder={m['server.schedules.commandPlaceholder']()}
                            className="font-mono text-sm"
                        />
                    </Field>
                ) : (
                    <Field
                        label={m['server.schedules.ignoredFilesLabel']()}
                        hint={m['server.schedules.ignoredFilesHint']()}
                        htmlFor="task-ignore"
                    >
                        <Textarea
                            id="task-ignore"
                            rows={2}
                            value={payload}
                            onChange={e => setPayload(e.target.value)}
                            className="font-mono text-sm"
                        />
                    </Field>
                )}

                <Field label={m['server.schedules.timeOffsetField']()} hint={m['server.schedules.timeOffsetHint']()} htmlFor="task-offset">
                    <Input
                        id="task-offset"
                        type="number"
                        min={0}
                        value={timeOffset}
                        onChange={e => setTimeOffset(e.target.value)}
                    />
                </Field>

                <label className="flex items-center justify-between gap-4">
                    <span>
                        <span className="block text-sm font-medium text-[var(--color-ink)]">
                            {m['server.schedules.continueOnFailureLabel']()}
                        </span>
                        <span className="block text-xs text-[var(--color-ink-faint)]">
                            {m['server.schedules.continueOnFailureHint']()}
                        </span>
                    </span>
                    <Switch
                        checked={continueOnFailure}
                        onChange={setContinueOnFailure}
                        label={m['server.schedules.continueOnFailureLabel']()}
                    />
                </label>
            </div>
        </Modal>
    );
}
