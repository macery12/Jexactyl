import { m } from '@/i18n';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Server, Gauge, Network, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { SectionCard, FieldGrid, FieldRow, SaveBar, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { useFlashes } from '@/state/flashes';
import { firstError, applyFieldErrors } from '@/lib/apiError';
import { createNode, updateNode, getNode, type NodeFormValues } from '@/api/nodes';
import { getDatabaseHosts } from '@/api/adminDatabases';

type FormShape = NodeFormValues;

const DEFAULTS: FormShape = {
    name: '',
    description: '',
    fqdn: '',
    scheme: 'https',
    behind_proxy: false,
    public: true,
    memory: 4096,
    memory_overallocate: 0,
    disk: 51200,
    disk_overallocate: 0,
    listen_port_http: 8080,
    public_port_http: 8080,
    listen_port_sftp: 2022,
    public_port_sftp: 2022,
    daemon_base: '/var/lib/pterodactyl/volumes',
    upload_size: 100,
    database_host_id: null,
};

// Mirrors Node::$validationRules so a bad value is caught here rather than
// coming back as an opaque 422. Keep these in sync with app/Models/Node.php.
const NAME_PATTERN = /^[\w .-]{1,100}$/;
const PORT = { min: 1, max: 65535 };

export default function NodeEditorPage() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const { id } = useParams<'id'>();
    const editing = Boolean(id);
    const [saving, setSaving] = useState(false);

    const { data: node, isLoading } = useQuery({
        queryKey: ['admin', 'node', id],
        queryFn: () => getNode(id!),
        enabled: editing,
    });

    const hostsQ = useQuery({ queryKey: ['admin', 'database-hosts'], queryFn: getDatabaseHosts });

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        setError,
        reset,
        formState: { errors, isDirty },
    } = useForm<FormShape>({
        // `values` (not `defaultValues`) so the form resyncs once the edit
        // target arrives from the query.
        values: node
            ? {
                  name: node.name,
                  description: node.description ?? '',
                  fqdn: node.fqdn,
                  scheme: node.scheme,
                  behind_proxy: node.isBehindProxy,
                  public: node.isPublic,
                  memory: node.memory,
                  memory_overallocate: node.memoryOverallocate,
                  disk: node.disk,
                  disk_overallocate: node.diskOverallocate,
                  listen_port_http: node.ports.httpListen,
                  public_port_http: node.ports.httpPublic,
                  listen_port_sftp: node.ports.sftpListen,
                  public_port_sftp: node.ports.sftpPublic,
                  daemon_base: node.daemonBase,
                  upload_size: node.uploadSize,
                  database_host_id: node.databaseHostId ?? null,
              }
            : DEFAULTS,
    });

    const req = { required: m['admin.infrastructure.common.required']() };
    const num = { required: m['admin.infrastructure.common.required'](), valueAsNumber: true };
    const port = {
        ...num,
        min: { value: PORT.min, message: m['admin.infrastructure.node.validation.port']() },
        max: { value: PORT.max, message: m['admin.infrastructure.node.validation.port']() },
    };

    const onSubmit = handleSubmit(async values => {
        setSaving(true);
        try {
            if (editing) {
                await updateNode(Number(id), values);
                await qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
                await qc.invalidateQueries({ queryKey: ['admin', 'node', id] });
                push({ type: 'success', message: m['admin.infrastructure.node.updated']() });
                reset(values); // re-baseline so the save bar goes clean
            } else {
                const created = await createNode(values);
                await qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
                push({ type: 'success', message: m['admin.infrastructure.node.created']() });
                navigate(`/admin/infrastructure/nodes/${created.id}`);
            }
        } catch (err) {
            // Attach per-field 422s inline; only fall back to a toast when the
            // failure isn't field-specific.
            if (!applyFieldErrors(err, setError)) {
                push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            }
        } finally {
            setSaving(false);
        }
    });

    if (editing && isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const backTo = editing ? `/admin/infrastructure/nodes/${id}` : '/admin/infrastructure';

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div>
                <Link
                    to={backTo}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {editing ? node?.name : m['admin.infrastructure.title']()}
                </Link>
                <h1 className="mt-1 truncate text-xl font-semibold text-[var(--color-ink)]">
                    {editing ? m['admin.infrastructure.node.editTitle']() : m['admin.infrastructure.node.createTitle']()}
                </h1>
                {!editing && <p className="mt-0.5 text-sm text-[var(--color-ink-faint)]">{m['admin.infrastructure.node.createSubtitle']()}</p>}
            </div>

            <div className="flex flex-col gap-5">
                <SectionCard
                    icon={Server}
                    title={m['admin.infrastructure.node.section.identity']()}
                    desc={m['admin.infrastructure.node.section.identityDesc']()}
                >
                    <FieldGrid>
                        <FieldRow label={m['admin.infrastructure.node.field.name']()} error={errors.name?.message}>
                            <Input
                                invalid={!!errors.name}
                                {...register('name', {
                                    ...req,
                                    pattern: { value: NAME_PATTERN, message: m['admin.infrastructure.node.validation.name']() },
                                })}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.scheme']()}>
                            <Select
                                value={watch('scheme')}
                                onChange={v => setValue('scheme', v as 'http' | 'https', { shouldDirty: true })}
                                options={[
                                    { value: 'https', label: 'https' },
                                    { value: 'http', label: 'http' },
                                ]}
                            />
                        </FieldRow>
                        <FieldRow
                            label={m['admin.infrastructure.node.field.fqdn']()}
                            desc={m['admin.infrastructure.node.field.fqdnHint']()}
                            error={errors.fqdn?.message}
                        >
                            <Input invalid={!!errors.fqdn} placeholder="node.example.com" {...register('fqdn', req)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.description']()}>
                            <Input {...register('description')} />
                        </FieldRow>
                    </FieldGrid>
                    <ToggleGroup>
                        <ToggleRow
                            label={m['admin.infrastructure.node.field.behindProxy']()}
                            desc={m['admin.infrastructure.node.field.behindProxyDesc']()}
                            checked={watch('behind_proxy')}
                            onChange={v => setValue('behind_proxy', v, { shouldDirty: true })}
                        />
                        <ToggleRow
                            label={m['admin.infrastructure.node.field.public']()}
                            desc={m['admin.infrastructure.node.field.publicDesc']()}
                            checked={watch('public')}
                            onChange={v => setValue('public', v, { shouldDirty: true })}
                        />
                    </ToggleGroup>
                </SectionCard>

                <SectionCard
                    icon={Gauge}
                    title={m['admin.infrastructure.node.section.capacity']()}
                    desc={m['admin.infrastructure.node.section.capacityDesc']()}
                >
                    <FieldGrid>
                        <FieldRow label={m['admin.infrastructure.node.field.memory']()} mono="MiB" error={errors.memory?.message}>
                            <Input
                                type="number"
                                min={1}
                                invalid={!!errors.memory}
                                {...register('memory', { ...num, min: { value: 1, message: m['admin.infrastructure.node.validation.minOne']() } })}
                            />
                        </FieldRow>
                        <FieldRow
                            label={m['admin.infrastructure.node.field.memoryOver']()}
                            desc={m['admin.infrastructure.node.field.overHint']()}
                            mono="%"
                            error={errors.memory_overallocate?.message}
                        >
                            <Input
                                type="number"
                                min={-1}
                                invalid={!!errors.memory_overallocate}
                                {...register('memory_overallocate', {
                                    ...num,
                                    min: { value: -1, message: m['admin.infrastructure.node.validation.overallocate']() },
                                })}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.disk']()} mono="MiB" error={errors.disk?.message}>
                            <Input
                                type="number"
                                min={1}
                                invalid={!!errors.disk}
                                {...register('disk', { ...num, min: { value: 1, message: m['admin.infrastructure.node.validation.minOne']() } })}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.diskOver']()} mono="%" error={errors.disk_overallocate?.message}>
                            <Input
                                type="number"
                                min={-1}
                                invalid={!!errors.disk_overallocate}
                                {...register('disk_overallocate', {
                                    ...num,
                                    min: { value: -1, message: m['admin.infrastructure.node.validation.overallocate']() },
                                })}
                            />
                        </FieldRow>
                    </FieldGrid>
                </SectionCard>

                <SectionCard
                    icon={Network}
                    title={m['admin.infrastructure.node.section.ports']()}
                    desc={m['admin.infrastructure.node.section.portsDesc']()}
                >
                    <FieldGrid>
                        <FieldRow label={m['admin.infrastructure.node.field.listenHttp']()} error={errors.listen_port_http?.message}>
                            <Input type="number" min={PORT.min} max={PORT.max} invalid={!!errors.listen_port_http} {...register('listen_port_http', port)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.publicHttp']()} error={errors.public_port_http?.message}>
                            <Input type="number" min={PORT.min} max={PORT.max} invalid={!!errors.public_port_http} {...register('public_port_http', port)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.listenSftp']()} error={errors.listen_port_sftp?.message}>
                            <Input type="number" min={PORT.min} max={PORT.max} invalid={!!errors.listen_port_sftp} {...register('listen_port_sftp', port)} />
                        </FieldRow>
                        <FieldRow label={m['admin.infrastructure.node.field.publicSftp']()} error={errors.public_port_sftp?.message}>
                            <Input type="number" min={PORT.min} max={PORT.max} invalid={!!errors.public_port_sftp} {...register('public_port_sftp', port)} />
                        </FieldRow>
                    </FieldGrid>
                </SectionCard>

                <SectionCard
                    icon={SlidersHorizontal}
                    title={m['admin.infrastructure.node.section.advanced']()}
                    desc={m['admin.infrastructure.node.section.advancedDesc']()}
                >
                    {/* Full width: an absolute path needs the room. */}
                    <FieldRow
                        wide
                        label={m['admin.infrastructure.node.field.daemonBase']()}
                        desc={m['admin.infrastructure.node.field.daemonBaseHint']()}
                        error={errors.daemon_base?.message}
                    >
                        <Input invalid={!!errors.daemon_base} {...register('daemon_base')} />
                    </FieldRow>
                    <FieldGrid>
                        <FieldRow
                            label={m['admin.infrastructure.node.field.uploadSize']()}
                            mono="MiB"
                            error={errors.upload_size?.message}
                        >
                            <Input
                                type="number"
                                min={1}
                                max={1024}
                                invalid={!!errors.upload_size}
                                {...register('upload_size', {
                                    valueAsNumber: true,
                                    min: { value: 1, message: m['admin.infrastructure.node.validation.uploadSize']() },
                                    max: { value: 1024, message: m['admin.infrastructure.node.validation.uploadSize']() },
                                })}
                            />
                        </FieldRow>
                        <FieldRow
                            label={m['admin.infrastructure.node.field.databaseHost']()}
                            desc={m['admin.infrastructure.node.field.databaseHostHint']()}
                        >
                            <Select
                                value={watch('database_host_id') == null ? '' : String(watch('database_host_id'))}
                                onChange={v => setValue('database_host_id', v === '' ? null : Number(v), { shouldDirty: true })}
                                options={[
                                    { value: '', label: m['admin.infrastructure.node.field.databaseHostNone']() },
                                    ...(hostsQ.data ?? []).map(h => ({ value: String(h.id), label: `${h.name} (${h.host}:${h.port})` })),
                                ]}
                                placeholder={m['admin.infrastructure.node.field.databaseHostNone']()}
                            />
                        </FieldRow>
                    </FieldGrid>
                </SectionCard>
            </div>

            <SaveBar dirty={isDirty} saving={saving} onDiscard={() => reset()} />
        </form>
    );
}
