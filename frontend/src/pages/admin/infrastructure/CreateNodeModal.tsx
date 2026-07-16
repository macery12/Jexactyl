import { m } from '@/i18n';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { createNode, updateNode, type NodeFormValues, type NodeDetail } from '@/api/nodes';

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
};

function firstError(err: unknown): string | undefined {
    if (isAxiosError(err)) {
        const errors = err.response?.data?.errors;
        if (Array.isArray(errors) && errors[0]?.detail) return errors[0].detail;
        return err.response?.data?.message;
    }
    return undefined;
}

export function CreateNodeModal({
    open,
    onClose,
    node,
}: {
    open: boolean;
    onClose: () => void;
    node?: NodeDetail;
}) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const editing = !!node;

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors },
    } = useForm<FormShape>({
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
              }
            : DEFAULTS,
    });

    const mutation = useMutation({
        mutationFn: (values: FormShape) => (editing ? updateNode(node!.id, values) : createNode(values)),
        onSuccess: async () => {
            push({ type: 'success', message: editing ? m['admin.infrastructure.node.updated']() : m['admin.infrastructure.node.created']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
            if (editing) await qc.invalidateQueries({ queryKey: ['admin', 'node', node!.id] });
            reset();
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const req = { required: m['admin.infrastructure.common.required']() };
    const num = { required: m['admin.infrastructure.common.required'](), valueAsNumber: true };
    const scheme = watch('scheme');

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={editing ? m['admin.infrastructure.node.editTitle']() : m['admin.infrastructure.node.createTitle']()}
            description={editing ? undefined : m['admin.infrastructure.node.createSubtitle']()}
            size="lg"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={handleSubmit(v => mutation.mutate(v))} disabled={mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {editing ? m['common.actions.saveChanges']() : m['common.actions.create']()}
                    </Button>
                </>
            }
        >
            <form className="flex flex-col gap-6" onSubmit={handleSubmit(v => mutation.mutate(v))}>
                <Section title={m['admin.infrastructure.node.section.identity']()}>
                    <Field label={m['admin.infrastructure.node.field.name']()} error={errors.name?.message}>
                        <Input invalid={!!errors.name} {...register('name', req)} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.description']()}>
                        <Input {...register('description')} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.fqdn']()} error={errors.fqdn?.message}>
                        <Input invalid={!!errors.fqdn} placeholder="node.example.com" {...register('fqdn', req)} />
                        <span className="text-xs text-[var(--color-ink-faint)]">{m['admin.infrastructure.node.field.fqdnHint']()}</span>
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.scheme']()}>
                        <Select
                            value={scheme}
                            onChange={v => setValue('scheme', v as 'http' | 'https')}
                            options={[
                                { value: 'https', label: 'https' },
                                { value: 'http', label: 'http' },
                            ]}
                        />
                    </Field>
                    <Toggle label={m['admin.infrastructure.node.field.behindProxy']()} checked={watch('behind_proxy')} onChange={v => setValue('behind_proxy', v)} />
                    <Toggle label={m['admin.infrastructure.node.field.public']()} checked={watch('public')} onChange={v => setValue('public', v)} />
                </Section>

                <Section title={m['admin.infrastructure.node.section.capacity']()}>
                    <Field label={m['admin.infrastructure.node.field.memory']()} error={errors.memory?.message}>
                        <Input type="number" invalid={!!errors.memory} {...register('memory', num)} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.memoryOver']()}>
                        <Input type="number" {...register('memory_overallocate', num)} />
                        <span className="text-xs text-[var(--color-ink-faint)]">{m['admin.infrastructure.node.field.overHint']()}</span>
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.disk']()} error={errors.disk?.message}>
                        <Input type="number" invalid={!!errors.disk} {...register('disk', num)} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.diskOver']()}>
                        <Input type="number" {...register('disk_overallocate', num)} />
                    </Field>
                </Section>

                <Section title={m['admin.infrastructure.node.section.ports']()}>
                    <Field label={m['admin.infrastructure.node.field.listenHttp']()}>
                        <Input type="number" {...register('listen_port_http', num)} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.publicHttp']()}>
                        <Input type="number" {...register('public_port_http', num)} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.listenSftp']()}>
                        <Input type="number" {...register('listen_port_sftp', num)} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.publicSftp']()}>
                        <Input type="number" {...register('public_port_sftp', num)} />
                    </Field>
                </Section>

                <Section title={m['admin.infrastructure.node.section.advanced']()}>
                    <Field label={m['admin.infrastructure.node.field.daemonBase']()}>
                        <Input {...register('daemon_base')} />
                    </Field>
                    <Field label={m['admin.infrastructure.node.field.uploadSize']()}>
                        <Input type="number" {...register('upload_size', { valueAsNumber: true })} />
                    </Field>
                </Section>
            </form>
        </Modal>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{title}</h4>
            <div className="grid gap-4 sm:grid-cols-2">{children}</div>
        </div>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center gap-3 self-end py-2 text-sm text-[var(--color-ink)]">
            <Switch checked={checked} onChange={onChange} />
            {label}
        </label>
    );
}
