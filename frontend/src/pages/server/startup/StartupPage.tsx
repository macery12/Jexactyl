import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, History } from 'lucide-react';
import { m } from '@/i18n';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import {
    getStartup,
    updateStartupVariable,
    setDockerImage,
    VERSION_HELPER_VARIABLES,
    type EggVariable,
    type StartupData,
} from '@/api/startup';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';

const VersionPickerModal = lazy(() => import('./VersionPickerModal'));

export default function StartupPage() {
    const server = useServer();
    const held = server.permissions;
    const canUpdate = can(held, 'startup.update');
    const canUpdateImage = can(held, 'startup.docker-image');
    const canReinstall = can(held, 'settings.reinstall');

    const qc = useQueryClient();
    const key = ['server', server.id, 'startup'];

    const { data, isLoading, isError } = useQuery({
        queryKey: key,
        queryFn: () => getStartup(server.uuid),
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }
    if (isError || !data) {
        return <p className="py-16 text-center text-sm text-[var(--color-danger)]">{m['server.startup.loadError']()}</p>;
    }

    // Context for version-dependent providers (e.g. Paper builds need the MC version).
    const versionContext: Record<string, string> = {};
    for (const v of data.variables) {
        if (v.envVariable === 'MINECRAFT_VERSION' || v.envVariable === 'MC_VERSION') {
            versionContext[v.envVariable] = v.serverValue ?? v.defaultValue ?? '';
        }
    }
    const jarVar = data.variables.find(v => v.envVariable === 'SERVER_JARFILE');
    const serverJar = jarVar?.serverValue ?? jarVar?.defaultValue ?? '';

    return (
        <div className="flex flex-col">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.startup.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.startup.subtitle']()}</p>
            </div>

            {/* One flat surface: labelled sections divided by hairlines, no cards. */}
            <Section eyebrow={m['server.startup.commandTitle']()} desc={m['server.startup.commandDesc']()}>
                <CommandBlock invocation={data.invocation} />
            </Section>

            <Section eyebrow={m['server.startup.imageTitle']()} desc={m['server.startup.imageDesc']()}>
                <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
                    <DockerImage
                        data={data}
                        current={server.dockerImage}
                        canUpdate={canUpdateImage}
                        onSaved={() => qc.invalidateQueries({ queryKey: key })}
                    />
                </div>
            </Section>

            <Section eyebrow={m['server.startup.variablesTitle']()} desc={m['server.startup.variablesDesc']()}>
                {data.variables.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['server.startup.noVariables']()}</p>
                ) : (
                    <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
                        {data.variables.map(v => (
                            <VariableField
                                key={v.envVariable}
                                variable={v}
                                canEdit={canUpdate}
                                canReinstall={canReinstall}
                                context={versionContext}
                                serverJar={serverJar}
                                queryKey={key}
                            />
                        ))}
                    </div>
                )}
            </Section>
        </div>
    );
}

function Section({ eyebrow, desc, children }: { eyebrow: string; desc: string; children: React.ReactNode }) {
    return (
        <section className="border-t border-[var(--color-border)] pt-7 pb-1 mt-7 first:mt-8 first:border-t-0 first:pt-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--brand)]">{eyebrow}</p>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{desc}</p>
            <div className="mt-5">{children}</div>
        </section>
    );
}

function CommandBlock({ invocation }: { invocation: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard?.writeText(invocation).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        });
    };
    return (
        <div className="relative">
            <button
                type="button"
                onClick={copy}
                aria-label={m['server.startup.copyCommand']()}
                className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
                {copied ? <Check className="h-3 w-3 text-[var(--brand)]" /> : <Copy className="h-3 w-3" />}
                {copied ? m['common.states.copied']() : m['server.startup.copyCommand']()}
            </button>
            <pre className="overflow-x-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-4 pr-24 font-mono text-xs leading-relaxed text-[var(--color-ink)]">
                {invocation}
            </pre>
        </div>
    );
}

function DockerImage({
    data,
    current,
    canUpdate,
    onSaved,
}: {
    data: StartupData;
    current: string;
    canUpdate: boolean;
    onSaved: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const options = Object.entries(data.dockerImages).map(([label, value]) => ({ label, value }));
    // Match V1: compare case-insensitively so an egg image that differs only in
    // casing still resolves to a dropdown selection rather than a "custom" lock.
    const currentLc = current.toLowerCase();
    const matched = options.find(o => o.value.toLowerCase() === currentLc);
    const isCustom = options.length > 0 && !matched;

    const save = useMutation({
        mutationFn: (image: string) => setDockerImage(server.uuid, image),
        onSuccess: () => {
            push({ type: 'success', message: m['server.startup.imageSaved']() });
            onSaved();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    if (canUpdate && options.length > 1 && !isCustom) {
        return (
            <div className="min-w-0">
                <div className="flex items-center gap-3">
                    <Select
                        value={matched?.value ?? current}
                        onChange={image => save.mutate(image)}
                        options={options}
                        disabled={save.isPending}
                        className="w-full"
                    />
                    {save.isPending && <Spinner className="h-4 w-4 shrink-0" />}
                </div>
            </div>
        );
    }

    return (
        <div className="min-w-0">
            <Input value={current} readOnly disabled className="w-full font-mono text-xs" />
            {isCustom && <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{m['server.startup.imageCustom']()}</p>}
        </div>
    );
}

function VariableField({
    variable,
    canEdit,
    canReinstall,
    context,
    serverJar,
    queryKey,
}: {
    variable: EggVariable;
    canEdit: boolean;
    canReinstall: boolean;
    context: Record<string, string>;
    serverJar: string;
    queryKey: unknown[];
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [value, setValue] = useState(variable.serverValue ?? '');
    const [pickerOpen, setPickerOpen] = useState(false);

    const editable = canEdit && variable.isEditable;

    const useSwitch = variable.rules.some(r => r === 'boolean' || r === 'in:0,1' || r === 'in:true,false');
    const selectValues = variable.rules.find(r => r.startsWith('in:'))?.slice(3).split(',') ?? [];
    const useSelect = !useSwitch && selectValues.length > 0;
    // Assisted version picker only for known version vars that aren't already a
    // switch or fixed-choice select.
    const hasVersionHelper = !useSwitch && selectValues.length === 0 && VERSION_HELPER_VARIABLES.has(variable.envVariable);

    const save = useMutation({
        mutationFn: (next: string) => updateStartupVariable(server.uuid, variable.envVariable, next),
        onSuccess: ({ invocation }) => {
            qc.setQueryData<StartupData>(queryKey as string[], prev =>
                prev
                    ? {
                          ...prev,
                          invocation,
                          variables: prev.variables.map(v =>
                              v.envVariable === variable.envVariable ? { ...v, serverValue: value } : v,
                          ),
                      }
                    : prev,
            );
        },
        onError: () => {
            setValue(variable.serverValue ?? '');
            push({ type: 'error', message: m['common.states.genericError']() });
        },
    });

    const commit = (next: string) => {
        setValue(next);
        if (next !== (variable.serverValue ?? '')) save.mutate(next);
    };

    const on = value === '1' || value === 'true';

    return (
        <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
                <label className="truncate text-xs font-semibold text-[var(--color-ink)]">{variable.name}</label>
                <div className="flex shrink-0 items-center gap-2">
                    {save.isPending && <Spinner className="h-3.5 w-3.5" />}
                    {hasVersionHelper ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-xs"
                            onClick={() => setPickerOpen(true)}
                            disabled={!editable}
                        >
                            <History className="h-3.5 w-3.5" />
                            {m['server.startup.versions.button']()}
                        </Button>
                    ) : (
                        <span className="truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                            {variable.envVariable}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex min-h-[2.75rem] items-center">
                {useSwitch ? (
                    <div className="flex items-center gap-2.5">
                        <Switch
                            checked={on}
                            onChange={next => commit(next ? '1' : '0')}
                            disabled={!editable || save.isPending}
                            label={variable.name}
                        />
                        <span className="text-xs text-[var(--color-ink-muted)]">
                            {on ? m['common.states.enabled']() : m['common.states.disabled']()}
                        </span>
                    </div>
                ) : useSelect ? (
                    <Select
                        value={value}
                        onChange={commit}
                        options={selectValues.map(o => ({ label: o, value: o }))}
                        disabled={!editable || save.isPending}
                        className="w-full"
                    />
                ) : (
                    <Input
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onBlur={() => commit(value)}
                        readOnly={!editable}
                        disabled={!editable}
                        placeholder={variable.defaultValue}
                        className="w-full font-mono text-xs"
                    />
                )}
            </div>

            <p className="mt-2 text-xs leading-snug text-[var(--color-ink-faint)]">{variable.description}</p>

            {pickerOpen && (
                <Suspense fallback={null}>
                    <VersionPickerModal
                        variable={variable}
                        context={context}
                        serverJar={serverJar}
                        canReinstall={canReinstall}
                        onClose={() => setPickerOpen(false)}
                        onSaved={() => qc.invalidateQueries({ queryKey })}
                    />
                </Suspense>
            )}
        </div>
    );
}
