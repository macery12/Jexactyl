import { m } from '@/i18n/messages';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info, MapPin, Package, Gauge, SlidersHorizontal, Terminal, AlertTriangle, Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { SectionCard, FieldGrid, FieldRow, SaveBar, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { cn } from '@/lib/cn';
import { useFlashes } from '@/state/flashes';
import { firstError, applyFieldErrors } from '@/lib/apiError';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { createServer, type CreateServerValues } from '@/api/adminServers';
import { getServerPresets, type ServerPreset } from '@/api/serverPresets';
import { getNodes, getDeployableNodes, getNodeAllocations } from '@/api/nodes';
import { getNests, getNestEggs, getEgg, firstDockerImage } from '@/api/nests';
import { getUsers } from '@/api/adminUsers';
import { PresetManager } from './PresetManager';

interface FormShape {
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

const DEFAULTS: FormShape = {
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
};

// Mirrors StoreServerRequest / Server::$validationRules — catching these here
// beats a bare 422 toast with no indication of which field was wrong.
const IO = { min: 10, max: 1000 };

export default function ServerEditorPage() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const held = useAdminHeld();

    const [saving, setSaving] = useState(false);

    const [ownerId, setOwnerId] = useState<string>();
    const [nodeId, setNodeId] = useState<string>();
    const [allocationId, setAllocationId] = useState<string>();
    const [presetId, setPresetId] = useState<string>();
    const [nestId, setNestId] = useState<string>();
    const [eggId, setEggId] = useState<string>();
    const [image, setImage] = useState('');
    const [startup, setStartup] = useState('');
    const [environment, setEnvironment] = useState<Record<string, string>>({});
    const [ownerSearch, setOwnerSearch] = useState('');
    // null = closed. 'new' opens straight into an empty preset form, 'list'
    // opens the manager. Mounted conditionally so reopening always starts fresh.
    const [presetDialog, setPresetDialog] = useState<'new' | 'list' | null>(null);

    const canReadPresets = can(held, 'server-presets.read');
    const canCreatePresets = can(held, 'server-presets.create');

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        setError,
        reset,
        formState: { errors, isDirty },
    } = useForm<FormShape>({ defaultValues: DEFAULTS });

    const memory = watch('memory');
    const disk = watch('disk');

    // The owner picker is search-backed: the users endpoint caps at 100 rows, so
    // a plain dropdown silently hides everyone past the first page.
    const usersQ = useQuery({
        queryKey: ['admin', 'users', 'picker', ownerSearch],
        queryFn: () => getUsers(ownerSearch || undefined),
    });

    // Populate the node picker from the plain node list, NOT the deployable
    // endpoint: the latter requires memory/disk, hides non-public nodes, and
    // 400s rather than returning an empty list. Deployability is an advisory
    // overlay (below), not a precondition for showing the node at all.
    const nodesQ = useQuery({ queryKey: ['admin', 'nodes', 'picker'], queryFn: getNodes });
    const deployableQ = useQuery({
        queryKey: ['admin', 'deployable-nodes', memory, disk],
        queryFn: () => getDeployableNodes(Number(memory) || 0, Number(disk) || 0),
        enabled: Number.isFinite(Number(memory)) && Number.isFinite(Number(disk)),
    });

    const allocQ = useQuery({
        queryKey: ['admin', 'node-allocations', nodeId],
        queryFn: () => getNodeAllocations(Number(nodeId)),
        enabled: !!nodeId,
    });
    const presetsQ = useQuery({ queryKey: ['admin', 'server-presets'], queryFn: getServerPresets });
    const nestsQ = useQuery({ queryKey: ['admin', 'nests'], queryFn: getNests });
    const eggsQ = useQuery({
        queryKey: ['admin', 'nest-eggs', nestId],
        queryFn: () => getNestEggs(Number(nestId)),
        enabled: !!nestId,
    });
    const eggQ = useQuery({ queryKey: ['admin', 'egg', eggId], queryFn: () => getEgg(Number(eggId)), enabled: !!eggId });

    // When an egg loads, seed image / startup / env defaults.
    useEffect(() => {
        if (!eggQ.data) return;
        setImage(firstDockerImage(eggQ.data.dockerImages));
        setStartup(eggQ.data.startup);
        setEnvironment(Object.fromEntries(eggQ.data.variables.map(v => [v.envVariable, v.defaultValue])));
    }, [eggQ.data]);

    const freeAllocations = useMemo(() => (allocQ.data ?? []).filter(a => !a.isAssigned), [allocQ.data]);
    const deployableIds = useMemo(() => new Set((deployableQ.data ?? []).map(n => n.id)), [deployableQ.data]);

    const nodeOptions = useMemo(
        () =>
            (nodesQ.data ?? []).map(n => ({
                value: String(n.id),
                label: n.name,
                hint: deployableIds.has(n.id)
                    ? n.fqdn
                    : `${n.fqdn} · ${m['admin.infrastructure.server.nodeNoCapacity']()}`,
            })),
        [nodesQ.data, deployableIds],
    );

    const ownerOptions = useMemo(
        () => (usersQ.data ?? []).map(u => ({ value: String(u.id), label: u.username, hint: u.email })),
        [usersQ.data],
    );

    const handleOwnerSearch = useCallback((q: string) => setOwnerSearch(q), []);

    const selectedNode = (nodesQ.data ?? []).find(n => String(n.id) === nodeId);
    const selectedAllocation = freeAllocations.find(a => String(a.id) === allocationId);
    const selectedEgg = (eggsQ.data ?? []).find(e => String(e.id) === eggId);
    const selectedOwner = (usersQ.data ?? []).find(u => String(u.id) === ownerId);
    const selectedPreset = (presetsQ.data ?? []).find(p => String(p.id) === presetId);

    // A preset is a STARTING POINT, not a separate creation pipeline: it writes
    // its values into this form and then gets out of the way. Everything it sets
    // stays editable, and creation always goes through the one create path — so
    // owner, name and allocation are never taken out of the user's hands the way
    // the old dedicated preset endpoint did.
    const applyPreset = (preset: ServerPreset) => {
        const opts = { shouldDirty: true } as const;
        setValue('memory', preset.memory, opts);
        setValue('disk', preset.disk, opts);
        setValue('cpu', preset.cpu, opts);
        setValue('swap', preset.swap, opts);
        setValue('io', preset.io, opts);
        setValue('databases', preset.databases, opts);
        setValue('backups', preset.backups, opts);
        setValue('allocations', preset.allocations, opts);
        setValue('subusers', preset.subusers, opts);
        // Only overwrite the software choice when the preset actually pins one —
        // both columns are nullable, and clearing a user's egg would be worse
        // than leaving it be.
        if (preset.nestId) setNestId(String(preset.nestId));
        if (preset.eggId) setEggId(String(preset.eggId));
        // Name is a reasonable seed, but never clobber one the user typed.
        // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() opts out of the react compiler
        if (!watch('name')) setValue('name', preset.name, opts);
    };

    // First unmet requirement, in form order. Surfacing this beats an enabled
    // Save button whose handler silently bails — that reads as "creation is
    // broken", which is precisely how this form used to fail.
    const blockedReason = !watch('name')
        ? m['admin.infrastructure.server.blocked.name']()
        : !ownerId
          ? m['admin.infrastructure.server.blocked.owner']()
          : !nodeId
            ? m['admin.infrastructure.server.blocked.node']()
            : !allocationId
              ? m['admin.infrastructure.server.blocked.allocation']()
              : !eggId
                ? m['admin.infrastructure.server.blocked.egg']()
                : !image
                  ? m['admin.infrastructure.server.blocked.image']()
                  : null;

    async function finish(id: number | undefined) {
        await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
        push({ type: 'success', message: m['admin.infrastructure.server.created']() });
        navigate(id ? `/admin/infrastructure/servers/${id}` : '/admin/infrastructure');
    }

    function fail(err: unknown) {
        if (!applyFieldErrors(err, setError)) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        }
    }

    const submitManual = handleSubmit(async v => {
        setSaving(true);
        try {
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
            const created = await createServer(payload);
            await finish(created.id);
        } catch (err) {
            fail(err);
        } finally {
            setSaving(false);
        }
    });

    const num = { valueAsNumber: true };
    const req = { required: m['admin.infrastructure.common.required']() };

    // The pickers live outside RHF, so isDirty alone misses them.
    const dirty = isDirty || Boolean(ownerId || nodeId || eggId || presetId);

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (blockedReason || saving) return;
        void submitManual();
    };

    const discard = () => {
        reset(DEFAULTS);
        setOwnerId(undefined);
        setNodeId(undefined);
        setAllocationId(undefined);
        setPresetId(undefined);
        setNestId(undefined);
        setEggId(undefined);
        setImage('');
        setStartup('');
        setEnvironment({});
    };

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div>
                <Link
                    to="/admin/infrastructure"
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {m['admin.infrastructure.title']()}
                </Link>
                <h1 className="mt-1 truncate text-xl font-semibold text-[var(--color-ink)]">
                    {m['admin.infrastructure.server.createTitle']()}
                </h1>
                <p className="mt-0.5 text-sm text-[var(--color-ink-faint)]">{m['admin.infrastructure.server.createSubtitle']()}</p>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
                <div className="flex flex-col gap-5">
                    {canReadPresets && (
                        <SectionCard
                            icon={Package}
                            title={m['admin.infrastructure.server.group.preset']()}
                            desc={m['admin.infrastructure.server.group.presetDesc']()}
                            right={
                                <div className="flex items-center gap-1">
                                    {canCreatePresets && (
                                        <Button type="button" variant="outline" size="sm" onClick={() => setPresetDialog('new')}>
                                            <Plus className="h-4 w-4" /> {m['admin.infrastructure.presets.new']()}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setPresetDialog('list')}
                                        aria-label={m['admin.infrastructure.presets.manage']()}
                                    >
                                        <Settings2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            }
                        >
                            <FieldGrid>
                                <FieldRow wide label={m['admin.infrastructure.server.field.preset']()}>
                                    <Combobox
                                        value={presetId}
                                        onChange={v => {
                                            setPresetId(v);
                                            const preset = (presetsQ.data ?? []).find(p => String(p.id) === v);
                                            if (preset) applyPreset(preset);
                                        }}
                                        options={(presetsQ.data ?? []).map(p => ({
                                            value: String(p.id),
                                            label: p.name,
                                            hint: `${p.cpu}% CPU · ${p.memory} MiB · ${p.disk} MiB`,
                                        }))}
                                        placeholder={m['admin.infrastructure.server.selectPreset']()}
                                        loading={presetsQ.isLoading}
                                        error={presetsQ.isError ? m['admin.infrastructure.server.presetsFailed']() : null}
                                        emptyMessage={m['admin.infrastructure.server.noPresets']()}
                                    />
                                </FieldRow>
                            </FieldGrid>
                            {selectedPreset && (
                                <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                                    {m['admin.infrastructure.server.presetApplied']({ name: selectedPreset.name })}
                                </p>
                            )}
                        </SectionCard>
                    )}

                    <>
                            <SectionCard
                                icon={Info}
                                title={m['admin.infrastructure.server.group.details']()}
                                desc={m['admin.infrastructure.server.group.detailsDesc']()}
                            >
                                <FieldGrid>
                                    <FieldRow label={m['admin.infrastructure.server.field.name']()} error={errors.name?.message}>
                                        <Input invalid={!!errors.name} {...register('name', req)} />
                                    </FieldRow>
                                    <FieldRow
                                        label={m['admin.infrastructure.server.field.owner']()}
                                        desc={m['admin.infrastructure.server.field.ownerHint']()}
                                    >
                                        <Combobox
                                            value={ownerId}
                                            onChange={setOwnerId}
                                            options={ownerOptions}
                                            onSearch={handleOwnerSearch}
                                            placeholder={m['admin.infrastructure.server.selectOwner']()}
                                            searchPlaceholder={m['admin.infrastructure.server.searchOwner']()}
                                            loading={usersQ.isFetching}
                                            error={usersQ.isError ? m['admin.infrastructure.server.usersFailed']() : null}
                                            emptyMessage={m['admin.infrastructure.server.noUsers']()}
                                        />
                                    </FieldRow>
                                    <FieldRow wide label={m['admin.infrastructure.server.field.description']()}>
                                        <Input {...register('description')} />
                                    </FieldRow>
                                </FieldGrid>
                            </SectionCard>

                            <SectionCard
                                icon={MapPin}
                                title={m['admin.infrastructure.server.group.placement']()}
                                desc={m['admin.infrastructure.server.group.placementDesc']()}
                            >
                                <FieldGrid>
                                    <NodeField
                                        value={nodeId}
                                        onChange={v => {
                                            setNodeId(v);
                                            setAllocationId(undefined);
                                        }}
                                        options={nodeOptions}
                                        query={nodesQ}
                                    />
                                    <FieldRow
                                        label={m['admin.infrastructure.server.field.allocation']()}
                                        desc={!nodeId ? m['admin.infrastructure.server.allocationHint']() : undefined}
                                    >
                                        <Combobox
                                            value={allocationId}
                                            onChange={setAllocationId}
                                            options={freeAllocations.map(a => ({ value: String(a.id), label: `${a.ip}:${a.port}` }))}
                                            placeholder={m['admin.infrastructure.server.selectAllocation']()}
                                            disabled={!nodeId}
                                            loading={allocQ.isLoading}
                                            error={allocQ.isError ? m['admin.infrastructure.server.allocationsFailed']() : null}
                                            emptyMessage={m['admin.infrastructure.server.noAllocations']()}
                                        />
                                    </FieldRow>
                                </FieldGrid>
                            </SectionCard>

                            <SectionCard
                                icon={Terminal}
                                title={m['admin.infrastructure.server.group.egg']()}
                                desc={m['admin.infrastructure.server.group.eggDesc']()}
                            >
                                <FieldGrid>
                                    <FieldRow label={m['admin.infrastructure.server.field.nest']()}>
                                        <Combobox
                                            value={nestId}
                                            onChange={v => {
                                                setNestId(v);
                                                setEggId(undefined);
                                            }}
                                            options={(nestsQ.data ?? []).map(n => ({ value: String(n.id), label: n.name, hint: n.description ?? undefined }))}
                                            placeholder={m['admin.infrastructure.server.selectNest']()}
                                            loading={nestsQ.isLoading}
                                            error={nestsQ.isError ? m['admin.infrastructure.server.nestsFailed']() : null}
                                        />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.egg']()}>
                                        <Combobox
                                            value={eggId}
                                            onChange={setEggId}
                                            options={(eggsQ.data ?? []).map(e => ({ value: String(e.id), label: e.name }))}
                                            placeholder={m['admin.infrastructure.server.selectEgg']()}
                                            disabled={!nestId}
                                            loading={eggsQ.isLoading}
                                            error={eggsQ.isError ? m['admin.infrastructure.server.eggsFailed']() : null}
                                        />
                                    </FieldRow>
                                    <FieldRow wide label={m['admin.infrastructure.server.field.image']()}>
                                        <Input value={image} onChange={e => setImage(e.target.value)} />
                                    </FieldRow>
                                    {/* Startup commands are long — never squeeze them into a half column. */}
                                    <FieldRow wide label={m['admin.infrastructure.server.field.startup']()}>
                                        <Input className="font-mono text-xs" value={startup} onChange={e => setStartup(e.target.value)} />
                                    </FieldRow>
                                </FieldGrid>
                            </SectionCard>

                            {eggQ.data && eggQ.data.variables.length > 0 && (
                                <SectionCard
                                    icon={SlidersHorizontal}
                                    title={m['admin.infrastructure.server.group.environment']()}
                                    desc={m['admin.infrastructure.server.group.environmentDesc']()}
                                >
                                    <FieldGrid>
                                        {eggQ.data.variables.map(v => (
                                            <FieldRow key={v.envVariable} label={v.name} mono={v.envVariable}>
                                                <Input
                                                    value={environment[v.envVariable] ?? ''}
                                                    onChange={e => setEnvironment(prev => ({ ...prev, [v.envVariable]: e.target.value }))}
                                                />
                                            </FieldRow>
                                        ))}
                                    </FieldGrid>
                                </SectionCard>
                            )}

                            <SectionCard
                                icon={Gauge}
                                title={m['admin.infrastructure.server.group.limits']()}
                                desc={m['admin.infrastructure.server.group.limitsDesc']()}
                            >
                                <FieldGrid columns={3}>
                                    <FieldRow label={m['admin.infrastructure.server.field.memory']()} mono="MiB" error={errors.memory?.message}>
                                        <Input type="number" min={0} invalid={!!errors.memory} {...register('memory', { ...num, min: { value: 0, message: m['admin.infrastructure.server.validation.min0']() } })} />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.swap']()} mono="MiB" error={errors.swap?.message}>
                                        <Input type="number" min={-1} invalid={!!errors.swap} {...register('swap', { ...num, min: { value: -1, message: m['admin.infrastructure.server.validation.swap']() } })} />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.disk']()} mono="MiB" error={errors.disk?.message}>
                                        <Input type="number" min={0} invalid={!!errors.disk} {...register('disk', { ...num, min: { value: 0, message: m['admin.infrastructure.server.validation.min0']() } })} />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.cpu']()} mono="%" error={errors.cpu?.message}>
                                        <Input type="number" min={0} invalid={!!errors.cpu} {...register('cpu', { ...num, min: { value: 0, message: m['admin.infrastructure.server.validation.min0']() } })} />
                                    </FieldRow>
                                    <FieldRow
                                        label={m['admin.infrastructure.server.field.io']()}
                                        desc={m['admin.infrastructure.server.field.ioHint']()}
                                        error={errors.io?.message}
                                    >
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
                                    </FieldRow>
                                </FieldGrid>
                                <ToggleGroup>
                                    <ToggleRow
                                        label={m['admin.infrastructure.server.field.oomKiller']()}
                                        desc={m['admin.infrastructure.server.field.oomKillerDesc']()}
                                        checked={watch('oom_killer')}
                                        onChange={v => setValue('oom_killer', v, { shouldDirty: true })}
                                    />
                                </ToggleGroup>
                            </SectionCard>

                            <SectionCard
                                icon={Package}
                                title={m['admin.infrastructure.server.group.featureLimits']()}
                                desc={m['admin.infrastructure.server.group.featureLimitsDesc']()}
                            >
                                <FieldGrid columns={3}>
                                    <FieldRow label={m['admin.infrastructure.server.field.allocations']()}>
                                        <Input type="number" min={0} {...register('allocations', num)} />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.backups']()}>
                                        <Input type="number" min={0} {...register('backups', num)} />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.databases']()}>
                                        <Input type="number" min={0} {...register('databases', num)} />
                                    </FieldRow>
                                    <FieldRow label={m['admin.infrastructure.server.field.subusers']()}>
                                        <Input type="number" min={0} {...register('subusers', num)} />
                                    </FieldRow>
                                </FieldGrid>
                            </SectionCard>
                    </>
                </div>

                <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-6">
                    <div className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-5">
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.infrastructure.server.summary.title']()}</h2>
                        <dl className="mt-4 flex flex-col gap-3 text-sm">
                            {selectedPreset && (
                                <SummaryRow label={m['admin.infrastructure.server.field.preset']()} value={selectedPreset.name} />
                            )}
                            <SummaryRow label={m['admin.infrastructure.server.field.owner']()} value={selectedOwner?.username} />
                            <SummaryRow label={m['admin.infrastructure.server.field.egg']()} value={selectedEgg?.name} />
                            <SummaryRow label={m['admin.infrastructure.server.field.node']()} value={selectedNode?.name} />
                            <SummaryRow
                                label={m['admin.infrastructure.server.field.allocation']()}
                                value={selectedAllocation ? `${selectedAllocation.ip}:${selectedAllocation.port}` : undefined}
                            />
                            <SummaryRow label={m['admin.infrastructure.server.field.memory']()} value={`${memory || 0} MiB`} />
                            <SummaryRow label={m['admin.infrastructure.server.field.disk']()} value={`${disk || 0} MiB`} />
                        </dl>

                        {selectedNode && !deployableIds.has(selectedNode.id) && !deployableQ.isLoading && (
                            <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {m['admin.infrastructure.server.capacityWarning']()}
                            </p>
                        )}
                    </div>
                </aside>
            </div>

            <SaveBar dirty={dirty} saving={saving} onDiscard={discard} blockedReason={blockedReason} />

            {presetDialog !== null && (
                <PresetManager open onClose={() => setPresetDialog(null)} startNew={presetDialog === 'new'} />
            )}
        </form>
    );
}

// Shared between both modes so the node picker behaves identically either way.
function NodeField({
    value,
    onChange,
    options,
    query,
}: {
    value: string | undefined;
    onChange: (v: string) => void;
    options: { value: string; label: string; hint?: string }[];
    query: { isLoading: boolean; isError: boolean };
}) {
    return (
        <FieldRow label={m['admin.infrastructure.server.field.node']()}>
            <Combobox
                value={value}
                onChange={onChange}
                options={options}
                placeholder={m['admin.infrastructure.server.selectNode']()}
                loading={query.isLoading}
                error={query.isError ? m['admin.infrastructure.server.nodesFailed']() : null}
                emptyMessage={m['admin.infrastructure.server.noNodes']()}
            />
        </FieldRow>
    );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-[var(--color-ink-faint)]">{label}</dt>
            <dd className={cn('truncate text-right text-sm', value ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]')}>
                {value ?? '—'}
            </dd>
        </div>
    );
}
