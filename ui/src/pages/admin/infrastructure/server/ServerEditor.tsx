import { m, td } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Info, TerminalSquare, Gauge, Network, ListChecks, Save, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useFlashes } from '@/state/flashes';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useServerView } from './ServerContext';
import { NetworkingSection, type AllocationDraft } from './NetworkingSection';
import { updateServer, updateServerStartup, type ServerView } from '@/api/adminServers';
import { getUsers } from '@/api/adminUsers';
import { getNests, getNestEggs, getEgg, firstDockerImage, dockerImageOptions, type DockerImageOption } from '@/api/nests';

interface FormShape {
    name: string;
    externalId: string;
    ownerId: string;
    description: string;
    nestId: string;
    eggId: string;
    startup: string;
    image: string;
    skipScripts: boolean;
    cpu: number;
    threads: string;
    memory: number;
    swap: number;
    disk: number;
    io: number;
    oom_killer: boolean;
    allocations: number;
    backups: number;
    databases: number;
    subusers: number;
    subdomains: number;
}

interface VarDef {
    envVariable: string;
    name: string;
    description: string | null;
    defaultValue: string;
}

const SECTIONS: { id: string; labelKey: string; icon: LucideIcon }[] = [
    { id: 'information', labelKey: 'infrastructure.serverDetail.nav.information', icon: Info },
    { id: 'startup', labelKey: 'infrastructure.serverDetail.nav.startup', icon: TerminalSquare },
    { id: 'resources', labelKey: 'infrastructure.serverDetail.nav.resources', icon: Gauge },
    { id: 'networking', labelKey: 'infrastructure.serverDetail.nav.networking', icon: Network },
    { id: 'limits', labelKey: 'infrastructure.serverDetail.nav.limits', icon: ListChecks },
];

function formFrom(s: ServerView): FormShape {
    return {
        name: s.name,
        externalId: s.externalId ?? '',
        ownerId: String(s.ownerId),
        description: s.description ?? '',
        nestId: s.nestId ? String(s.nestId) : '',
        eggId: String(s.eggId),
        startup: s.container.startup,
        image: s.container.image,
        skipScripts: false,
        cpu: s.limits.cpu,
        threads: s.limits.threads ?? '',
        memory: s.limits.memory,
        swap: s.limits.swap,
        disk: s.limits.disk,
        io: s.limits.io,
        oom_killer: s.limits.oom_killer,
        allocations: s.featureLimits.allocations,
        backups: s.featureLimits.backups,
        databases: s.featureLimits.databases,
        subusers: s.featureLimits.subusers,
        subdomains: s.featureLimits.subdomains,
    };
}

function firstError(err: unknown, fallback: string): string {
    if (isAxiosError(err)) {
        const errors = err.response?.data?.errors;
        if (Array.isArray(errors) && errors[0]?.detail) return errors[0].detail;
        return err.response?.data?.message ?? fallback;
    }
    return fallback;
}

export function ServerEditor() {
    const s = useServerView();
    const qc = useQueryClient();
    const push = useFlashes(st => st.push);
    const held = useAdminHeld();
    const readOnly = !can(held, 'servers.update');

    const usersQ = useQuery({ queryKey: ['admin', 'users'], queryFn: () => getUsers() });
    const nestsQ = useQuery({ queryKey: ['admin', 'nests'], queryFn: getNests });

    const { register, handleSubmit, watch, setValue, reset, formState: { errors, isDirty } } = useForm<FormShape>({
        defaultValues: formFrom(s),
    });

    const nestId = watch('nestId');
    const eggId = watch('eggId');
    const eggsQ = useQuery({ queryKey: ['admin', 'nest-eggs', nestId], queryFn: () => getNestEggs(Number(nestId)), enabled: !!nestId });

    // Egg-dependent metadata (variables + docker image suggestions). Seeded from
    // the loaded server, then refreshed from the egg when the egg is changed.
    const [varDefs, setVarDefs] = useState<VarDef[]>(() => s.variables.map(v => ({ envVariable: v.envVariable, name: v.name, description: v.description, defaultValue: v.defaultValue })));
    const [imageOptions, setImageOptions] = useState<DockerImageOption[]>(s.dockerImages);
    const [env, setEnv] = useState<Record<string, string>>(() => Object.fromEntries(s.variables.map(v => [v.envVariable, v.serverValue])));
    const [envDirty, setEnvDirty] = useState(false);

    // Allocation staging (primary + add/remove), surfaced by NetworkingSection.
    const [alloc, setAlloc] = useState<AllocationDraft>({ primaryId: s.allocationId, addIds: [], removeIds: [] });

    // Re-seed all non-RHF state whenever a freshly-fetched server arrives.
    useEffect(() => {
        reset(formFrom(s));
        setVarDefs(s.variables.map(v => ({ envVariable: v.envVariable, name: v.name, description: v.description, defaultValue: v.defaultValue })));
        setImageOptions(s.dockerImages);
        setEnv(Object.fromEntries(s.variables.map(v => [v.envVariable, v.serverValue])));
        setEnvDirty(false);
        setAlloc({ primaryId: s.allocationId, addIds: [], removeIds: [] });
    }, [s, reset]);

    // When the egg changes to a different one, adopt that egg's defaults.
    const adoptEgg = async (newEggId: string) => {
        setValue('eggId', newEggId, { shouldDirty: true });
        if (Number(newEggId) === s.eggId) {
            // Returning to the original egg — restore the server's own values.
            setVarDefs(s.variables.map(v => ({ envVariable: v.envVariable, name: v.name, description: v.description, defaultValue: v.defaultValue })));
            setImageOptions(s.dockerImages);
            setEnv(Object.fromEntries(s.variables.map(v => [v.envVariable, v.serverValue])));
            setValue('image', s.container.image, { shouldDirty: true });
            setValue('startup', s.container.startup, { shouldDirty: true });
            setEnvDirty(false);
            return;
        }
        try {
            const egg = await getEgg(Number(newEggId));
            setVarDefs(egg.variables.map(v => ({ envVariable: v.envVariable, name: v.name, description: null, defaultValue: v.defaultValue })));
            setImageOptions(dockerImageOptions(egg.dockerImages));
            setEnv(Object.fromEntries(egg.variables.map(v => [v.envVariable, v.defaultValue])));
            setValue('image', firstDockerImage(egg.dockerImages), { shouldDirty: true });
            setValue('startup', egg.startup, { shouldDirty: true });
            setEnvDirty(true);
        } catch {
            push({ type: 'error', message: m['admin.infrastructure.common.loadError']() });
        }
    };

    const allocDirty = alloc.addIds.length > 0 || alloc.removeIds.length > 0 || alloc.primaryId !== s.allocationId;
    const dirty = isDirty || envDirty || allocDirty;

    const [saving, setSaving] = useState(false);
    const save = handleSubmit(async v => {
        setSaving(true);
        try {
            await updateServerStartup(s.id, {
                startup: v.startup,
                environment: env,
                egg_id: Number(v.eggId),
                image: v.image,
                skip_scripts: v.skipScripts,
            });
            await updateServer(s.id, {
                name: v.name,
                external_id: v.externalId || null,
                owner_id: Number(v.ownerId),
                limits: {
                    memory: Number(v.memory),
                    swap: Number(v.swap),
                    disk: Number(v.disk),
                    io: Number(v.io),
                    cpu: Number(v.cpu),
                    threads: v.threads.trim() ? v.threads.trim() : null,
                    oom_killer: v.oom_killer,
                },
                feature_limits: {
                    allocations: Number(v.allocations),
                    backups: Number(v.backups),
                    databases: Number(v.databases),
                    subusers: Number(v.subusers),
                    subdomains: Number(v.subdomains),
                },
                allocation_id: alloc.primaryId ?? undefined,
                add_allocations: alloc.addIds,
                remove_allocations: alloc.removeIds,
            });
            push({ type: 'success', message: m['admin.infrastructure.serverDetail.saved']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'server-view', String(s.id)] });
            await qc.invalidateQueries({ queryKey: ['admin', 'servers'] });
        } catch (err) {
            push({ type: 'error', message: firstError(err, m['common.states.genericError']()) });
        } finally {
            setSaving(false);
        }
    });

    const discard = () => {
        reset(formFrom(s));
        setEnv(Object.fromEntries(s.variables.map(v => [v.envVariable, v.serverValue])));
        setVarDefs(s.variables.map(v => ({ envVariable: v.envVariable, name: v.name, description: v.description, defaultValue: v.defaultValue })));
        setImageOptions(s.dockerImages);
        setEnvDirty(false);
        setAlloc({ primaryId: s.allocationId, addIds: [], removeIds: [] });
    };

    const num = { valueAsNumber: true, disabled: readOnly };
    const eggDefault = useMemo(() => s.container.startup, [s.container.startup]);

    // Always include the current owner, even if it falls outside the first page.
    const ownerOptions = useMemo(() => {
        const opts = (usersQ.data ?? []).map(u => ({ value: String(u.id), label: `${u.username} · ${u.email}` }));
        if (!opts.some(o => o.value === String(s.ownerId))) {
            opts.unshift({ value: String(s.ownerId), label: s.ownerName ?? `#${s.ownerId}` });
        }
        return opts;
    }, [usersQ.data, s.ownerId, s.ownerName]);

    // Docker image dropdown — egg images, plus the current image if it was set to
    // something outside the egg's list (a custom image set previously).
    const currentImage = watch('image');
    const imageSelectOptions = useMemo(() => {
        const opts = imageOptions.map(o => ({ value: o.value, label: o.label }));
        if (currentImage && !opts.some(o => o.value === currentImage)) {
            opts.unshift({ value: currentImage, label: currentImage });
        }
        return opts;
    }, [imageOptions, currentImage]);

    return (
        <div className="flex gap-6">
            <SectionNav />

            <form className="min-w-0 flex-1 space-y-6 pb-24" onSubmit={save}>
                {/* Information */}
                <SectionCard id="information" icon={Info} title={m['admin.infrastructure.serverDetail.nav.information']()} desc={m['admin.infrastructure.serverDetail.section.informationDesc']()}>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.name']()} error={errors.name?.message}>
                            <Input invalid={!!errors.name} disabled={readOnly} {...register('name', { required: m['admin.infrastructure.common.required']() })} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.externalId']()} desc={m['admin.infrastructure.serverDetail.field.externalIdDesc']()}>
                            <Input disabled={readOnly} {...register('externalId')} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.owner']()}>
                            <Select
                                value={watch('ownerId')}
                                onChange={v => setValue('ownerId', v, { shouldDirty: true })}
                                options={ownerOptions}
                                placeholder={m['admin.infrastructure.server.selectOwner']()}
                                disabled={readOnly}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.description']()}>
                            <Input disabled={readOnly} {...register('description')} />
                        </FieldRow>
                    </div>
                </SectionCard>

                {/* Startup */}
                <SectionCard id="startup" icon={TerminalSquare} title={m['admin.infrastructure.serverDetail.nav.startup']()} desc={m['admin.infrastructure.serverDetail.section.startupDesc']()}>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.nest']()}>
                            <Select
                                value={nestId || undefined}
                                onChange={v => { setValue('nestId', v, { shouldDirty: true }); }}
                                options={(nestsQ.data ?? []).map(n => ({ value: String(n.id), label: n.name }))}
                                placeholder={m['admin.infrastructure.server.selectNest']()}
                                disabled={readOnly}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.egg']()} desc={m['admin.infrastructure.serverDetail.field.eggDesc']()}>
                            <Select
                                value={eggId || undefined}
                                onChange={adoptEgg}
                                options={(eggsQ.data ?? []).map(e => ({ value: String(e.id), label: e.name }))}
                                placeholder={m['admin.infrastructure.server.selectEgg']()}
                                disabled={readOnly || !nestId}
                            />
                        </FieldRow>
                    </div>

                    <FieldRow label={m['admin.infrastructure.serverDetail.field.startup']()} desc={m['admin.infrastructure.serverDetail.field.startupDesc']({ vars: '{{SERVER_MEMORY}}, {{SERVER_IP}}, {{SERVER_PORT}}' })}>
                        <Input className="font-mono text-xs" disabled={readOnly} placeholder={eggDefault} {...register('startup')} />
                    </FieldRow>

                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.image']()} desc={m['admin.infrastructure.serverDetail.field.imageDesc']()}>
                            <Select
                                value={watch('image')}
                                onChange={v => setValue('image', v, { shouldDirty: true })}
                                options={imageSelectOptions}
                                placeholder={m['admin.infrastructure.server.selectImage']()}
                                disabled={readOnly}
                            />
                        </FieldRow>
                        <label className="flex items-end gap-3 pb-2 text-sm text-[var(--color-ink)]">
                            <Switch checked={watch('skipScripts')} onChange={v => setValue('skipScripts', v, { shouldDirty: true })} disabled={readOnly} />
                            {m['admin.infrastructure.serverDetail.field.skipScripts']()}
                        </label>
                    </div>

                    {varDefs.length > 0 && (
                        <div className="mt-2">
                            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{m['admin.infrastructure.serverDetail.variables']()}</p>
                            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                                {varDefs.map(v => (
                                    <FieldRow key={v.envVariable} label={v.name} desc={v.description ?? undefined} mono={v.envVariable}>
                                        <Input
                                            className="font-mono text-xs"
                                            placeholder={v.defaultValue}
                                            value={env[v.envVariable] ?? ''}
                                            disabled={readOnly}
                                            onChange={e => { setEnv(prev => ({ ...prev, [v.envVariable]: e.target.value })); setEnvDirty(true); }}
                                        />
                                    </FieldRow>
                                ))}
                            </div>
                        </div>
                    )}
                </SectionCard>

                {/* Resources */}
                <SectionCard id="resources" icon={Gauge} title={m['admin.infrastructure.serverDetail.nav.resources']()} desc={m['admin.infrastructure.serverDetail.section.resourcesDesc']()}>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.cpu']()} desc={m['admin.infrastructure.serverDetail.field.cpuDesc']()}>
                            <Input type="number" {...register('cpu', num)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.threads']()} desc={m['admin.infrastructure.serverDetail.field.threadsDesc']()}>
                            <Input disabled={readOnly} placeholder="0-1,3" {...register('threads')} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.memory']()}>
                            <Input type="number" {...register('memory', num)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.swap']()}>
                            <Input type="number" {...register('swap', num)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.disk']()}>
                            <Input type="number" {...register('disk', num)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.io']()} desc={m['admin.infrastructure.serverDetail.field.ioDesc']()}>
                            <Input type="number" {...register('io', num)} />
                        </FieldRow>
                    </div>
                    <label className="mt-2 flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 text-sm text-[var(--color-ink)]">
                        <Switch checked={watch('oom_killer')} onChange={v => setValue('oom_killer', v, { shouldDirty: true })} disabled={readOnly} />
                        <span>
                            {m['admin.infrastructure.serverDetail.field.oomKiller']()}
                            <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{m['admin.infrastructure.serverDetail.field.oomKillerDesc']()}</span>
                        </span>
                    </label>
                </SectionCard>

                {/* Networking */}
                <SectionCard id="networking" icon={Network} title={m['admin.infrastructure.serverDetail.nav.networking']()} desc={m['admin.infrastructure.serverDetail.section.networkingDesc']()}>
                    <NetworkingSection draft={alloc} onChange={setAlloc} readOnly={readOnly} />
                </SectionCard>

                {/* Feature limits */}
                <SectionCard id="limits" icon={ListChecks} title={m['admin.infrastructure.serverDetail.nav.limits']()} desc={m['admin.infrastructure.serverDetail.section.limitsDesc']()}>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.allocations']()}><Input type="number" {...register('allocations', num)} /></FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.backups']()}><Input type="number" {...register('backups', num)} /></FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.databases']()}><Input type="number" {...register('databases', num)} /></FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.subusers']()}><Input type="number" {...register('subusers', num)} /></FieldRow>
                        <FieldRow label={m['admin.infrastructure.serverDetail.field.subdomains']()} desc={m['admin.infrastructure.serverDetail.field.subdomainsDesc']()}>
                            <Input type="number" {...register('subdomains', num)} />
                        </FieldRow>
                    </div>
                </SectionCard>

                {!readOnly && <SaveBar dirty={dirty} saving={saving} onDiscard={discard} />}
            </form>
        </div>
    );
}

// ---- Layout pieces ------------------------------------------------------------

function SectionNav() {
    const [active, setActive] = useState('information');

    useEffect(() => {
        const els = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
        const obs = new IntersectionObserver(
            entries => {
                const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]) setActive(visible[0].target.id);
            },
            { rootMargin: '-15% 0px -75% 0px', threshold: 0 },
        );
        els.forEach(el => obs.observe(el));
        return () => obs.disconnect();
    }, []);

    return (
        <nav className="sticky top-4 hidden h-fit w-44 shrink-0 flex-col gap-1 lg:flex">
            {SECTIONS.map(sec => (
                <button
                    key={sec.id}
                    type="button"
                    onClick={() => document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className={cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        active === sec.id
                            ? 'bg-[var(--color-surface-2)] font-medium text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]/50 hover:text-[var(--color-ink)]',
                    )}
                >
                    <sec.icon className={cn('h-4 w-4', active === sec.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]')} />
                    {td(`admin.${sec.labelKey}`)}
                </button>
            ))}
        </nav>
    );
}

function SectionCard({ id, icon: Icon, title, desc, children }: { id: string; icon: LucideIcon; title: string; desc: string; children: React.ReactNode }) {
    return (
        <section id={id} className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                    <Icon className="h-4 w-4" />
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
                    <p className="text-xs text-[var(--color-ink-faint)]">{desc}</p>
                </div>
            </header>
            <div className="flex flex-col gap-5 p-5">{children}</div>
        </section>
    );
}

function FieldRow({ label, desc, mono, error, children }: { label: string; desc?: string; mono?: string; error?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="flex items-baseline gap-2 text-sm font-medium text-[var(--color-ink-muted)]">
                {label}
                {mono && <code className="font-mono text-[10px] text-[var(--color-ink-faint)]">{mono}</code>}
            </label>
            {children}
            {desc && <span className="text-xs text-[var(--color-ink-faint)]">{desc}</span>}
            {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
        </div>
    );
}

function SaveBar({ dirty, saving, onDiscard }: { dirty: boolean; saving: boolean; onDiscard: () => void }) {
    return (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-5 py-3 shadow-2xl shadow-black/30 backdrop-blur">
            <span className={cn('flex items-center gap-2 text-xs', dirty ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', dirty ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-ink-faint)]')} />
                {dirty ? m['admin.infrastructure.serverDetail.saveBar.dirty']() : m['admin.infrastructure.serverDetail.saveBar.clean']()}
            </span>
            <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={!dirty || saving}>
                    <RotateCcw className="h-4 w-4" /> {m['common.actions.discard']()}
                </Button>
                <Button type="submit" size="sm" disabled={!dirty || saving}>
                    {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {m['common.actions.saveChanges']()}
                </Button>
            </div>
        </div>
    );
}
