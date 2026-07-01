import { m, td } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useFlashes } from '@/state/flashes';
import { createServerFromPreset, createServer, type CreateServerValues } from '@/api/adminServers';
import { getServerPresets } from '@/api/serverPresets';
import { getDeployableNodes, getNodeAllocations } from '@/api/nodes';
import { getNests, getNestEggs, getEgg, firstDockerImage } from '@/api/nests';
import { getUsers } from '@/api/adminUsers';
import { PresetManager } from './PresetManager';

type Mode = 'preset' | 'manual';

function firstError(err: unknown, fallback: string): string {
    if (isAxiosError(err)) {
        const errors = err.response?.data?.errors;
        if (Array.isArray(errors) && errors[0]?.detail) return errors[0].detail;
        return err.response?.data?.message ?? fallback;
    }
    return fallback;
}

export function CreateServerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [mode, setMode] = useState<Mode>('preset');

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['admin.infrastructure.server.createTitle']()}
            description={m['admin.infrastructure.server.createSubtitle']()}
            size="lg"
        >
            <div className="mb-5 inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
                {(['preset', 'manual'] as Mode[]).map(opt => (
                    <button
                        key={opt}
                        onClick={() => setMode(opt)}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                            mode === opt
                                ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                                : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]',
                        )}
                    >
                        {td(`admin.infrastructure.server.mode.${opt}`)}
                    </button>
                ))}
            </div>

            {mode === 'preset' ? <PresetMode onClose={onClose} /> : <ManualMode onClose={onClose} />}
        </Modal>
    );
}

// ---- From-preset --------------------------------------------------------------

function PresetMode({ onClose }: { onClose: () => void }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [presetId, setPresetId] = useState<string>();
    const [nodeId, setNodeId] = useState<string>();
    const [showManager, setShowManager] = useState(false);

    const presetsQ = useQuery({ queryKey: ['admin', 'server-presets'], queryFn: getServerPresets });
    const nodesQ = useQuery({ queryKey: ['admin', 'deployable-nodes'], queryFn: getDeployableNodes });

    const create = useMutation({
        mutationFn: () => createServerFromPreset({ preset_id: Number(presetId), node_id: Number(nodeId) }),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.server.created']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err, m['common.states.genericError']()) }),
    });

    return (
        <div className="flex flex-col gap-4">
            <Field label={m['admin.infrastructure.server.field.preset']()}>
                <Select
                    value={presetId}
                    onChange={setPresetId}
                    options={(presetsQ.data ?? []).map(p => ({ value: String(p.id), label: p.name }))}
                    placeholder={m['admin.infrastructure.server.selectPreset']()}
                />
            </Field>
            <Field label={m['admin.infrastructure.server.field.node']()}>
                <Select
                    value={nodeId}
                    onChange={setNodeId}
                    options={(nodesQ.data ?? []).map(n => ({ value: String(n.id), label: n.name }))}
                    placeholder={m['admin.infrastructure.server.selectNode']()}
                />
                {nodesQ.data && nodesQ.data.length === 0 && (
                    <span className="text-xs text-[var(--color-warning)]">{m['admin.infrastructure.server.noDeployable']()}</span>
                )}
            </Field>

            <button
                type="button"
                onClick={() => setShowManager(v => !v)}
                className="self-start text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
                {m['admin.infrastructure.presets.manage']()}
            </button>
            {showManager && <PresetManager />}

            <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={onClose} disabled={create.isPending}>
                    {m['common.actions.cancel']()}
                </Button>
                <Button size="sm" disabled={!presetId || !nodeId || create.isPending} onClick={() => create.mutate()}>
                    {create.isPending && <Spinner className="h-4 w-4" />}
                    {m['common.actions.create']()}
                </Button>
            </div>
        </div>
    );
}

// ---- Manual builder -----------------------------------------------------------

interface ManualForm {
    name: string;
    description: string;
    memory: number;
    swap: number;
    disk: number;
    cpu: number;
    io: number;
    oom_killer: boolean;
    allocations: number;
    backups: number;
    databases: number;
    subusers: number;
}

function ManualMode({ onClose }: { onClose: () => void }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [ownerId, setOwnerId] = useState<string>();
    const [nodeId, setNodeId] = useState<string>();
    const [allocationId, setAllocationId] = useState<string>();
    const [nestId, setNestId] = useState<string>();
    const [eggId, setEggId] = useState<string>();
    const [image, setImage] = useState('');
    const [startup, setStartup] = useState('');
    const [environment, setEnvironment] = useState<Record<string, string>>({});

    const usersQ = useQuery({ queryKey: ['admin', 'users'], queryFn: () => getUsers() });
    const nodesQ = useQuery({ queryKey: ['admin', 'deployable-nodes'], queryFn: getDeployableNodes });
    const allocQ = useQuery({
        queryKey: ['admin', 'node-allocations', nodeId],
        queryFn: () => getNodeAllocations(Number(nodeId)),
        enabled: !!nodeId,
    });
    const nestsQ = useQuery({ queryKey: ['admin', 'nests'], queryFn: getNests });
    const eggsQ = useQuery({ queryKey: ['admin', 'nest-eggs', nestId], queryFn: () => getNestEggs(Number(nestId)), enabled: !!nestId });
    const eggQ = useQuery({ queryKey: ['admin', 'egg', eggId], queryFn: () => getEgg(Number(eggId)), enabled: !!eggId });

    // When an egg loads, seed image / startup / env defaults.
    useEffect(() => {
        if (!eggQ.data) return;
        setImage(firstDockerImage(eggQ.data.dockerImages));
        setStartup(eggQ.data.startup);
        setEnvironment(Object.fromEntries(eggQ.data.variables.map(v => [v.envVariable, v.defaultValue])));
    }, [eggQ.data]);

    const freeAllocations = useMemo(() => (allocQ.data ?? []).filter(a => !a.isAssigned), [allocQ.data]);

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<ManualForm>({
        defaultValues: {
            name: '',
            description: '',
            memory: 1024,
            swap: 0,
            disk: 5120,
            cpu: 100,
            io: 500,
            oom_killer: false,
            allocations: 0,
            backups: 0,
            databases: 0,
            subusers: 0,
        },
    });

    const create = useMutation({
        mutationFn: (v: ManualForm) => {
            const payload: CreateServerValues = {
                name: v.name,
                description: v.description || null,
                owner_id: Number(ownerId),
                node_id: Number(nodeId),
                egg_id: Number(eggId),
                image,
                startup,
                environment,
                skip_scripts: false,
                limits: {
                    memory: Number(v.memory),
                    swap: Number(v.swap),
                    disk: Number(v.disk),
                    io: Number(v.io),
                    cpu: Number(v.cpu),
                    threads: null,
                    oom_killer: v.oom_killer,
                },
                feature_limits: {
                    allocations: Number(v.allocations),
                    backups: Number(v.backups),
                    databases: Number(v.databases),
                    subusers: Number(v.subusers),
                },
                allocation: { default: Number(allocationId) },
            };
            return createServer(payload);
        },
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.infrastructure.server.created']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err, m['common.states.genericError']()) }),
    });

    const canSubmit = !!ownerId && !!nodeId && !!allocationId && !!eggId && !!image;
    const req = { required: m['admin.infrastructure.common.required']() };
    const num = { valueAsNumber: true };

    return (
        <form className="flex flex-col gap-6" onSubmit={handleSubmit(v => create.mutate(v))}>
            <Group title={m['admin.infrastructure.server.group.details']()}>
                <Field label={m['admin.infrastructure.server.field.name']()} error={errors.name?.message}>
                    <Input invalid={!!errors.name} {...register('name', req)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.owner']()}>
                    <Select
                        value={ownerId}
                        onChange={setOwnerId}
                        options={(usersQ.data ?? []).map(u => ({ value: String(u.id), label: `${u.username} · ${u.email}` }))}
                        placeholder={m['admin.infrastructure.server.selectOwner']()}
                    />
                </Field>
                <Field label={m['admin.infrastructure.server.field.description']()}>
                    <Input {...register('description')} />
                </Field>
            </Group>

            <Group title={m['admin.infrastructure.server.group.placement']()}>
                <Field label={m['admin.infrastructure.server.field.node']()}>
                    <Select
                        value={nodeId}
                        onChange={v => {
                            setNodeId(v);
                            setAllocationId(undefined);
                        }}
                        options={(nodesQ.data ?? []).map(n => ({ value: String(n.id), label: n.name }))}
                        placeholder={m['admin.infrastructure.server.selectNode']()}
                    />
                </Field>
                <Field label={m['admin.infrastructure.server.field.allocation']()}>
                    <Select
                        value={allocationId}
                        onChange={setAllocationId}
                        options={freeAllocations.map(a => ({ value: String(a.id), label: `${a.ip}:${a.port}` }))}
                        placeholder={m['admin.infrastructure.server.selectAllocation']()}
                        disabled={!nodeId}
                    />
                    {nodeId && freeAllocations.length === 0 && !allocQ.isLoading && (
                        <span className="text-xs text-[var(--color-warning)]">{m['admin.infrastructure.server.noAllocations']()}</span>
                    )}
                </Field>
            </Group>

            <Group title={m['admin.infrastructure.server.group.egg']()}>
                <Field label={m['admin.infrastructure.server.field.nest']()}>
                    <Select
                        value={nestId}
                        onChange={v => {
                            setNestId(v);
                            setEggId(undefined);
                        }}
                        options={(nestsQ.data ?? []).map(n => ({ value: String(n.id), label: n.name }))}
                        placeholder={m['admin.infrastructure.server.selectNest']()}
                    />
                </Field>
                <Field label={m['admin.infrastructure.server.field.egg']()}>
                    <Select
                        value={eggId}
                        onChange={setEggId}
                        options={(eggsQ.data ?? []).map(e => ({ value: String(e.id), label: e.name }))}
                        placeholder={m['admin.infrastructure.server.selectEgg']()}
                        disabled={!nestId}
                    />
                </Field>
                <Field label={m['admin.infrastructure.server.field.image']()}>
                    <Input value={image} onChange={e => setImage(e.target.value)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.startup']()}>
                    <Input value={startup} onChange={e => setStartup(e.target.value)} />
                </Field>
            </Group>

            {eggQ.data && eggQ.data.variables.length > 0 && (
                <Group title={m['admin.infrastructure.server.group.environment']()}>
                    {eggQ.data.variables.map(v => (
                        <Field key={v.envVariable} label={v.name}>
                            <Input
                                value={environment[v.envVariable] ?? ''}
                                onChange={e => setEnvironment(prev => ({ ...prev, [v.envVariable]: e.target.value }))}
                            />
                        </Field>
                    ))}
                </Group>
            )}

            <Group title={m['admin.infrastructure.server.group.limits']()}>
                <Field label={m['admin.infrastructure.server.field.memory']()}>
                    <Input type="number" {...register('memory', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.swap']()}>
                    <Input type="number" {...register('swap', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.disk']()}>
                    <Input type="number" {...register('disk', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.cpu']()}>
                    <Input type="number" {...register('cpu', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.io']()}>
                    <Input type="number" {...register('io', num)} />
                </Field>
                <label className="flex items-center gap-3 self-end py-2 text-sm text-[var(--color-ink)]">
                    <Switch checked={watch('oom_killer')} onChange={v => setValue('oom_killer', v)} />
                    {m['admin.infrastructure.server.field.oomKiller']()}
                </label>
            </Group>

            <Group title={m['admin.infrastructure.server.group.featureLimits']()}>
                <Field label={m['admin.infrastructure.server.field.allocations']()}>
                    <Input type="number" {...register('allocations', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.backups']()}>
                    <Input type="number" {...register('backups', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.databases']()}>
                    <Input type="number" {...register('databases', num)} />
                </Field>
                <Field label={m['admin.infrastructure.server.field.subusers']()}>
                    <Input type="number" {...register('subusers', num)} />
                </Field>
            </Group>

            <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={create.isPending}>
                    {m['common.actions.cancel']()}
                </Button>
                <Button type="submit" size="sm" disabled={!canSubmit || create.isPending}>
                    {create.isPending && <Spinner className="h-4 w-4" />}
                    {m['common.actions.create']()}
                </Button>
            </div>
        </form>
    );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{title}</h4>
            <div className="grid gap-4 sm:grid-cols-2">{children}</div>
        </div>
    );
}
