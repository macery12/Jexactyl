import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { getStartupVersions, updateStartupVariable, type EggVariable } from '@/api/startup';
import { reinstallServer } from '@/api/serverSettings';
import { deleteFiles } from '@/api/files';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';

// Assisted version picker for well-known startup variables (Vanilla/Paper/Forge/
// Sponge/…). Fetches a live list server-side, then applies the choice by writing
// the variable and reinstalling — the install script is what actually downloads
// the selected version. Ported from V1's VariableBox version modal.
export default function VersionPickerModal({
    variable,
    context,
    serverJar,
    canReinstall,
    onClose,
    onSaved,
}: {
    variable: EggVariable;
    context: Record<string, string>;
    serverJar: string;
    canReinstall: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);

    const [selected, setSelected] = useState(variable.serverValue ?? variable.defaultValue ?? '');
    const [includeSnapshots, setIncludeSnapshots] = useState(false);
    const [deleteJar, setDeleteJar] = useState(true);

    const versions = useQuery({
        queryKey: ['server', server.id, 'startup-versions', variable.envVariable, includeSnapshots],
        queryFn: () => getStartupVersions(server.uuid, variable.envVariable, includeSnapshots, context),
        staleTime: 5 * 60_000,
    });

    // Keep the current value selectable even if it isn't in the fetched list.
    const options = versions.data?.options ?? [];
    const hasCurrent = selected !== '' && options.some(o => o.value === selected);
    const selectOptions = [
        ...(hasCurrent ? [] : selected ? [{ value: selected, label: selected }] : []),
        ...options.map(o => ({
            value: o.value,
            label: o.stable ? o.label : m['server.startup.versions.snapshotLabel']({ label: o.label }),
        })),
    ];

    useEffect(() => {
        setSelected(variable.serverValue ?? variable.defaultValue ?? '');
    }, [variable.serverValue, variable.defaultValue]);

    const save = useMutation({
        mutationFn: async () => {
            await updateStartupVariable(server.uuid, variable.envVariable, selected);
            if (deleteJar && serverJar) {
                try {
                    await deleteFiles(server.uuid, '/', [serverJar]);
                } catch {
                    push({ type: 'warning', message: m['server.startup.versions.jarWarn']({ jar: serverJar }) });
                }
            }
            await reinstallServer(server.uuid);
        },
        onSuccess: () => {
            push({ type: 'success', message: m['server.startup.versions.started']() });
            onSaved();
            onClose();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const submit = () => {
        if (!selected) {
            push({ type: 'error', message: m['server.startup.versions.selectFirst']() });
            return;
        }
        save.mutate();
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.startup.versions.title']({ name: variable.name })}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={submit}
                        disabled={save.isPending || !canReinstall || !variable.isEditable}
                    >
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.startup.versions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-[var(--color-ink-muted)]">{m['server.startup.versions.intro']()}</p>

                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                        {m['server.startup.versions.select']()}
                    </span>
                    {versions.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                            <Spinner className="h-4 w-4" /> {m['common.states.loading']()}
                        </div>
                    ) : selectOptions.length === 0 ? (
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['server.startup.versions.empty']()}</p>
                    ) : (
                        <Select value={selected} onChange={setSelected} options={selectOptions} disabled={save.isPending} />
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => versions.refetch()}
                        disabled={versions.isFetching || save.isPending}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${versions.isFetching ? 'animate-spin' : ''}`} />
                        {m['server.startup.versions.refresh']()}
                    </Button>
                    {versions.data?.supportsSnapshots && (
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                            <Switch
                                checked={includeSnapshots}
                                onChange={setIncludeSnapshots}
                                disabled={save.isPending}
                                label={m['server.startup.versions.includeSnapshots']()}
                            />
                            {m['server.startup.versions.includeSnapshots']()}
                        </label>
                    )}
                </div>

                {versions.data?.stale && (
                    <p className="text-xs text-[var(--color-warning)]">{m['server.startup.versions.stale']()}</p>
                )}
                {versions.isError && (
                    <p className="text-xs text-[var(--color-danger)]">{m['server.startup.versions.loadError']()}</p>
                )}

                {serverJar && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                        <Switch
                            checked={deleteJar}
                            onChange={setDeleteJar}
                            disabled={save.isPending}
                            label={m['server.startup.versions.deleteJar']({ jar: serverJar })}
                        />
                        {m['server.startup.versions.deleteJar']({ jar: serverJar })}
                    </label>
                )}

                <div className="flex gap-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                    <div>
                        <p className="text-sm font-semibold text-[var(--color-ink)]">
                            {m['server.startup.versions.warningTitle']()}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                            {m['server.startup.versions.warningBody']()}
                        </p>
                    </div>
                </div>

                {!canReinstall && (
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['server.startup.versions.noReinstallPerm']()}</p>
                )}
            </div>
        </Modal>
    );
}
