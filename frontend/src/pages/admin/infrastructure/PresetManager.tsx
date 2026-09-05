import { m } from '@/i18n/messages';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Plus, X } from 'lucide-react';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { can } from '@/lib/can';
import { firstError } from '@/lib/apiError';
import { formatMib } from '@/lib/format';
import {
    getServerPresets,
    createServerPreset,
    updateServerPreset,
    deleteServerPreset,
    type ServerPreset,
    type PresetFormValues,
} from '@/api/serverPresets';
import { getNests, getNestEggs } from '@/api/nests';

interface FormShape {
    name: string;
    description: string;
    cpu: number;
    memory: number;
    disk: number;
    swap: number;
    io: number;
    databases: number;
    backups: number;
    allocations: number;
    subusers: number;
    nest_id: string;
    egg_id: string;
}

// Mirrors Server::$validationRules — a preset that can hold an io value the
// server itself would reject is a trap the user only discovers at create time.
const IO = { min: 10, max: 1000 };

// Preset CRUD, opened as a dialog from the create-server page. Self-contained:
// owns its queries and invalidates ['admin','server-presets'] so the picker
// that launched it refreshes with whatever was just saved.
//
// `startNew` opens straight into an empty form — the "New preset" entry point.
// Without it the dialog opens on the list.
export function PresetManager({ open, onClose, startNew = false }: { open: boolean; onClose: () => void; startNew?: boolean }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const held = useAdminHeld();

    const canCreate = can(held, 'server-presets.create');
    const canUpdate = can(held, 'server-presets.update');
    const canDelete = can(held, 'server-presets.delete');

    const presetsQ = useQuery({ queryKey: ['admin', 'server-presets'], queryFn: getServerPresets, enabled: open });
    const nestsQ = useQuery({ queryKey: ['admin', 'nests'], queryFn: getNests, enabled: open });

    const [editing, setEditing] = useState<ServerPreset | 'new' | null>(startNew ? 'new' : null);
    const [toDelete, setToDelete] = useState<ServerPreset | null>(null);

    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'server-presets'] });

    const del = useMutation({
        mutationFn: (id: number) => deleteServerPreset(id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.presets.deleted']() });
            await invalidate();
            setToDelete(null);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={editing !== null ? (editing === 'new' ? m['admin.infrastructure.presets.new']() : m['admin.infrastructure.presets.edit']()) : m['admin.infrastructure.presets.title']()}
            description={m['admin.infrastructure.presets.desc']()}
        >
            {editing !== null ? (
                <PresetForm
                    preset={editing === 'new' ? null : editing}
                    nests={(nestsQ.data ?? []).map(n => ({ value: String(n.id), label: n.name }))}
                    onDone={async () => {
                        await invalidate();
                        // Creating from the "New preset" entry point should hand
                        // the user straight back to the server form they came
                        // from, not strand them on a list they never asked for.
                        if (startNew) onClose();
                        else setEditing(null);
                    }}
                    onCancel={() => (startNew ? onClose() : setEditing(null))}
                />
            ) : (
                <div className="flex flex-col gap-3">
                    {presetsQ.isLoading ? (
                        <div className="flex justify-center py-10">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : (presetsQ.data ?? []).length === 0 ? (
                        <p className="py-8 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.infrastructure.presets.empty']()}</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                            {presetsQ.data!.map(p => (
                                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-[var(--color-ink)]">{p.name}</p>
                                        <p className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                            {p.cpu}% · {formatMib(p.memory)} · {formatMib(p.disk)}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {canUpdate && (
                                            <button
                                                type="button"
                                                onClick={() => setEditing(p)}
                                                aria-label={m['common.actions.edit']()}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        {canDelete && (
                                            <button
                                                type="button"
                                                onClick={() => setToDelete(p)}
                                                aria-label={m['common.actions.delete']()}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    {canCreate && (
                        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setEditing('new')}>
                            <Plus className="h-4 w-4" /> {m['admin.infrastructure.presets.new']()}
                        </Button>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.infrastructure.presets.deleteTitle']()}
                body={m['admin.infrastructure.presets.deleteBody']({ name: toDelete?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.id)}
            />
        </Modal>
    );
}

function PresetForm({
    preset,
    nests,
    onDone,
    onCancel,
}: {
    preset: ServerPreset | null;
    nests: { value: string; label: string }[];
    onDone: () => void;
    onCancel: () => void;
}) {
    const push = useFlashes(s => s.push);
    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<FormShape>({
        defaultValues: {
            name: preset?.name ?? '',
            description: preset?.description ?? '',
            cpu: preset?.cpu ?? 100,
            memory: preset?.memory ?? 1024,
            disk: preset?.disk ?? 5120,
            swap: preset?.swap ?? 0,
            io: preset?.io ?? 500,
            databases: preset?.databases ?? 0,
            backups: preset?.backups ?? 0,
            allocations: preset?.allocations ?? 0,
            subusers: preset?.subusers ?? 0,
            nest_id: preset?.nestId ? String(preset.nestId) : '',
            egg_id: preset?.eggId ? String(preset.eggId) : '',
        },
    });

    // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() opts out of the react compiler
    const nestId = watch('nest_id');
    const eggsQ = useQuery({
        queryKey: ['admin', 'nest-eggs', nestId],
        queryFn: () => getNestEggs(Number(nestId)),
        enabled: !!nestId,
    });

    const save = useMutation({
        mutationFn: (v: FormShape) => {
            const payload: PresetFormValues = {
                name: v.name,
                description: v.description || null,
                cpu: Number(v.cpu),
                memory: Number(v.memory),
                disk: Number(v.disk),
                swap: Number(v.swap),
                io: Number(v.io),
                databases: Number(v.databases),
                backups: Number(v.backups),
                allocations: Number(v.allocations),
                subusers: Number(v.subusers),
                nest_id: v.nest_id ? Number(v.nest_id) : null,
                egg_id: v.egg_id ? Number(v.egg_id) : null,
            };
            return preset ? updateServerPreset(preset.id, payload) : createServerPreset(payload);
        },
        onSuccess: () => {
            push({
                type: 'success',
                message: preset ? m['admin.infrastructure.presets.updated']() : m['admin.infrastructure.presets.created'](),
            });
            onDone();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const num = { valueAsNumber: true };
    const req = { required: m['admin.infrastructure.common.required']() };

    return (
        // Deliberately a <div>, not a <form>. The dialog is portalled out of the
        // DOM but stays inside the server form in the REACT tree, so a nested
        // form's submit event would bubble up and trigger server creation.
        <div className="flex flex-col gap-5">
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <Field label={m['admin.infrastructure.presets.name']()} error={errors.name?.message}>
                    <Input invalid={!!errors.name} {...register('name', req)} />
                </Field>
                <Field label={m['admin.infrastructure.presets.description']()}>
                    <Input {...register('description')} />
                </Field>
                <Field label={m['admin.infrastructure.presets.nest']()}>
                    <Select
                        value={nestId || undefined}
                        onChange={v => {
                            setValue('nest_id', v);
                            setValue('egg_id', '');
                        }}
                        options={nests}
                        placeholder={m['admin.infrastructure.server.selectNest']()}
                    />
                </Field>
                <Field label={m['admin.infrastructure.presets.egg']()}>
                    <Select
                        value={watch('egg_id') || undefined}
                        onChange={v => setValue('egg_id', v)}
                        options={(eggsQ.data ?? []).map(e => ({ value: String(e.id), label: e.name }))}
                        placeholder={m['admin.infrastructure.server.selectEgg']()}
                        disabled={!nestId}
                    />
                </Field>
            </div>

            <PresetFieldset legend={m['admin.infrastructure.server.group.limits']()}>
                <Field label={m['admin.infrastructure.presets.cpu']()}>
                    <Input type="number" min={0} {...register('cpu', num)} />
                </Field>
                <Field label={m['admin.infrastructure.presets.memory']()}>
                    <Input type="number" min={0} {...register('memory', num)} />
                </Field>
                <Field label={m['admin.infrastructure.presets.disk']()}>
                    <Input type="number" min={0} {...register('disk', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.swap']()}>
                    <Input type="number" min={-1} {...register('swap', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.io']()} error={errors.io?.message}>
                    <Input
                        type="number"
                        min={IO.min}
                        max={IO.max}
                        invalid={!!errors.io}
                        {...register('io', {
                            ...num,
                            min: { value: IO.min, message: m['admin.infrastructure.server.validation.io']() },
                            max: { value: IO.max, message: m['admin.infrastructure.server.validation.io']() },
                        })}
                    />
                </Field>
            </PresetFieldset>

            <PresetFieldset legend={m['admin.infrastructure.server.group.featureLimits']()}>
                <Field label={m['admin.infrastructure.server.field.allocations']()}>
                    <Input type="number" min={0} {...register('allocations', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.backups']()}>
                    <Input type="number" min={0} {...register('backups', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.databases']()}>
                    <Input type="number" min={0} {...register('databases', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.subusers']()}>
                    <Input type="number" min={-1} {...register('subusers', num)} />
                </Field>
            </PresetFieldset>

            <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={save.isPending}>
                    <X className="h-4 w-4" /> {m['common.actions.cancel']()}
                </Button>
                <Button type="button" size="sm" disabled={save.isPending} onClick={handleSubmit(v => save.mutate(v))}>
                    {save.isPending && <Spinner className="h-4 w-4" />}
                    {preset ? m['common.actions.saveChanges']() : m['common.actions.create']()}
                </Button>
            </div>
        </div>
    );
}

function PresetFieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{legend}</p>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
        </div>
    );
}
