import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { m, td } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { saveSchedule, type Cron, type Schedule } from '@/api/schedules';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';

const CRON_FIELDS: { key: keyof Cron; label: string; placeholder: string }[] = [
    { key: 'minute', label: 'server.schedules.cron.minute', placeholder: '*/5' },
    { key: 'hour', label: 'server.schedules.cron.hour', placeholder: '*' },
    { key: 'dayOfMonth', label: 'server.schedules.cron.dayOfMonth', placeholder: '*' },
    { key: 'month', label: 'server.schedules.cron.month', placeholder: '*' },
    { key: 'dayOfWeek', label: 'server.schedules.cron.dayOfWeek', placeholder: '*' },
];

export default function ScheduleFormModal({
    schedule,
    onClose,
    onSaved,
}: {
    schedule: Schedule | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const isEdit = !!schedule;

    const [name, setName] = useState(schedule?.name ?? '');
    const [isActive, setIsActive] = useState(schedule?.isActive ?? true);
    const [onlyWhenOnline, setOnlyWhenOnline] = useState(schedule?.onlyWhenOnline ?? false);
    const [cron, setCron] = useState<Cron>(
        schedule?.cron ?? { minute: '*/5', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*' },
    );

    const save = useMutation({
        mutationFn: () =>
            saveSchedule(server.uuid, { id: schedule?.id, name: name.trim(), cron, isActive, onlyWhenOnline }),
        onSuccess: () => {
            push({ type: 'success', message: isEdit ? m['server.schedules.updated']() : m['server.schedules.created']() });
            onSaved();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={isEdit ? m['server.schedules.editTitle']() : m['server.schedules.createTitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || name.trim().length === 0}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <Field label={m['server.schedules.name']()} htmlFor="schedule-name">
                    <Input
                        id="schedule-name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={m['server.schedules.namePlaceholder']()}
                    />
                </Field>

                <div>
                    <p className="mb-2 text-sm font-medium text-[var(--color-ink-muted)]">{m['server.schedules.cron.title']()}</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        {CRON_FIELDS.map(f => (
                            <label key={f.key} className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--color-ink-faint)]">{td(f.label)}</span>
                                <Input
                                    value={cron[f.key]}
                                    onChange={e => setCron(c => ({ ...c, [f.key]: e.target.value }))}
                                    placeholder={f.placeholder}
                                    className="font-mono text-sm"
                                />
                            </label>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{m['server.schedules.cron.hint']()}</p>
                </div>

                <label className="flex items-center justify-between gap-4">
                    <span>
                        <span className="block text-sm font-medium text-[var(--color-ink)]">{m['server.schedules.activeLabel']()}</span>
                        <span className="block text-xs text-[var(--color-ink-faint)]">{m['server.schedules.activeHint']()}</span>
                    </span>
                    <Switch checked={isActive} onChange={setIsActive} label={m['server.schedules.activeLabel']()} />
                </label>

                <label className="flex items-center justify-between gap-4">
                    <span>
                        <span className="block text-sm font-medium text-[var(--color-ink)]">{m['server.schedules.onlyOnlineLabel']()}</span>
                        <span className="block text-xs text-[var(--color-ink-faint)]">{m['server.schedules.onlyOnlineHint']()}</span>
                    </span>
                    <Switch checked={onlyWhenOnline} onChange={setOnlyWhenOnline} label={m['server.schedules.onlyOnlineLabel']()} />
                </label>
            </div>
        </Modal>
    );
}
