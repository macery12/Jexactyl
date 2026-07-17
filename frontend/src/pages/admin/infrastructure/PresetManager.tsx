import { m } from '@/i18n';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Plus, X } from 'lucide-react';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
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
    nest_id: string;
    egg_id: string;
}

// Inline preset CRUD, rendered inside the create-server modal. Self-contained:
// owns its own queries and invalidates ['admin','server-presets'].
export function PresetManager() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const presetsQ = useQuery({ queryKey: ['admin', 'server-presets'], queryFn: getServerPresets });
    const nestsQ = useQuery({ queryKey: ['admin', 'nests'], queryFn: getNests });

    const [editing, setEditing] = useState<ServerPreset | 'new' | null>(null);
    const [toDelete, setToDelete] = useState<ServerPreset | null>(null);

    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'server-presets'] });

    const del = useMutation({
        mutationFn: (id: number) => deleteServerPreset(id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.presets.deleted']() });
            await invalidate();
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 p-4">
            <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.infrastructure.presets.title']()}</h4>
                {editing === null && (
                    <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
                        <Plus className="h-4 w-4" /> {m['admin.infrastructure.presets.new']()}
                    </Button>
                )}
            </div>

            {editing !== null ? (
                <PresetForm
                    preset={editing === 'new' ? null : editing}
                    nests={(nestsQ.data ?? []).map(n => ({ value: String(n.id), label: n.name }))}
                    onDone={async () => {
                        await invalidate();
                        setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                />
            ) : presetsQ.isLoading ? (
                <div className="flex justify-center py-6">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : (presetsQ.data ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.infrastructure.presets.empty']()}</p>
            ) : (
                <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                    {presetsQ.data!.map(p => (
                        <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[var(--color-ink)]">{p.name}</p>
                                <p className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                    {p.cpu}% · {formatMib(p.memory)} · {formatMib(p.disk)}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <button
                                    onClick={() => setEditing(p)}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={() => setToDelete(p)}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
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
        </div>
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
            nest_id: preset?.nestId ? String(preset.nestId) : '',
            egg_id: preset?.eggId ? String(preset.eggId) : '',
        },
    });

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
                nest_id: v.nest_id ? Number(v.nest_id) : null,
                egg_id: v.egg_id ? Number(v.egg_id) : null,
            };
            return preset ? updateServerPreset(preset.id, payload) : createServerPreset(payload);
        },
        onSuccess: () => {
            push({ type: 'success', message: preset ? m['admin.infrastructure.presets.updated']() : m['admin.infrastructure.presets.created']() });
            onDone();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const req = { required: m['admin.infrastructure.common.required']() };

    return (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(v => save.mutate(v))}>
            <Field label={m['admin.infrastructure.presets.name']()} error={errors.name?.message}>
                <Input invalid={!!errors.name} {...register('name', req)} />
            </Field>
            <Field label={m['admin.infrastructure.presets.description']()}>
                <Input {...register('description')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
                <Field label={m['admin.infrastructure.presets.cpu']()}>
                    <Input type="number" {...register('cpu', { valueAsNumber: true })} />
                </Field>
                <Field label={m['admin.infrastructure.presets.memory']()}>
                    <Input type="number" {...register('memory', { valueAsNumber: true })} />
                </Field>
                <Field label={m['admin.infrastructure.presets.disk']()}>
                    <Input type="number" {...register('disk', { valueAsNumber: true })} />
                </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={save.isPending}>
                    <X className="h-4 w-4" /> {m['common.actions.cancel']()}
                </Button>
                <Button type="submit" size="sm" disabled={save.isPending}>
                    {save.isPending && <Spinner className="h-4 w-4" />}
                    {preset ? m['common.actions.saveChanges']() : m['common.actions.create']()}
                </Button>
            </div>
        </form>
    );
}
