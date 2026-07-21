import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Info,
    Container,
    Variable,
    ScrollText,
    Settings2,
    Save,
    Download,
    Trash2,
    type LucideIcon,
} from 'lucide-react';
import { m, td } from '@/i18n';
import { cn } from '@/lib/cn';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { useWideContent } from '@/components/shell/shellLayout';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    getEggDetail,
    createEgg,
    updateEgg,
    deleteEgg,
    dockerMapToRows,
    dockerRowsToMap,
    parseLines,
    type AdminEggDetail,
    type DockerRow,
    type EggPayload,
} from '@/api/adminNests';
import { CodeEditor } from './CodeEditor';
import { DockerImageManager } from './DockerImageManager';
import { VariablesTab } from './VariablesTab';
import { ExportEggModal } from './ExportEggModal';

// The egg editor's shared draft. Docker images + file denylist are edited in a
// friendlier shape than the API payload and collapsed on save.
interface EggForm {
    name: string;
    description: string;
    startup: string;
    configStop: string;
    updateUrl: string;
    dockerRows: DockerRow[];
    configStartup: string;
    configFiles: string;
    features: string[];
    fileDenylistText: string;
    forceOutgoingIp: boolean;
    scriptContainer: string;
    scriptEntry: string;
    scriptInstall: string;
    scriptIsPrivileged: boolean;
}

// Same defaults V1's NewEggContainer seeded.
const CREATE_DEFAULTS: EggForm = {
    name: '',
    description: '',
    startup: '',
    configStop: 'stop',
    updateUrl: '',
    dockerRows: [{ image: '', alias: '' }],
    configStartup: JSON.stringify({ done: [], strip_ansi: false, user_interaction: [] }, null, 4),
    configFiles: '{}',
    features: [],
    fileDenylistText: '',
    forceOutgoingIp: false,
    scriptContainer: 'ghcr.io/pterodactyl/installers:debian',
    scriptEntry: '/bin/bash',
    scriptInstall: '',
    scriptIsPrivileged: false,
};

function formFromEgg(egg: AdminEggDetail): EggForm {
    return {
        name: egg.name,
        description: egg.description ?? '',
        startup: egg.startup,
        configStop: egg.configStop ?? '',
        updateUrl: egg.updateUrl ?? '',
        dockerRows: dockerMapToRows(egg.dockerImages),
        configStartup: JSON.stringify(egg.configStartup ?? {}, null, 4),
        configFiles: JSON.stringify(egg.configFiles ?? {}, null, 4),
        features: egg.features,
        fileDenylistText: egg.fileDenylist.join('\n'),
        forceOutgoingIp: egg.forceOutgoingIp,
        scriptContainer: egg.scriptContainer,
        scriptEntry: egg.scriptEntry,
        scriptInstall: egg.scriptInstall ?? '',
        scriptIsPrivileged: egg.scriptIsPrivileged,
    };
}

function fullPayload(form: EggForm): EggPayload {
    return {
        name: form.name,
        description: form.description,
        startup: form.startup,
        configStop: form.configStop,
        updateUrl: form.updateUrl || null,
        dockerImages: dockerRowsToMap(form.dockerRows),
        configStartup: form.configStartup,
        configFiles: form.configFiles,
        features: form.features,
        fileDenylist: parseLines(form.fileDenylistText),
        forceOutgoingIp: form.forceOutgoingIp,
        scriptContainer: form.scriptContainer,
        scriptEntry: form.scriptEntry,
        scriptInstall: form.scriptInstall,
        scriptIsPrivileged: form.scriptIsPrivileged,
    };
}

type TabId = 'about' | 'docker' | 'variables' | 'install' | 'advanced';

const TABS: { id: TabId; labelKey: string; icon: LucideIcon }[] = [
    { id: 'about', labelKey: 'admin.nests.egg.tabs.about', icon: Info },
    { id: 'docker', labelKey: 'admin.nests.egg.tabs.docker', icon: Container },
    { id: 'variables', labelKey: 'admin.nests.egg.tabs.variables', icon: Variable },
    { id: 'install', labelKey: 'admin.nests.egg.tabs.install', icon: ScrollText },
    { id: 'advanced', labelKey: 'admin.nests.egg.tabs.advanced', icon: Settings2 },
];

// Field subset each edit-mode tab is responsible for, so per-tab Save only
// writes what that tab owns (mirrors V1's per-tab saves).
const TAB_KEYS: Record<Exclude<TabId, 'variables'>, (keyof EggForm)[]> = {
    about: ['name', 'description', 'updateUrl', 'startup', 'configStop', 'configStartup', 'configFiles'],
    docker: ['dockerRows'],
    install: ['scriptContainer', 'scriptEntry', 'scriptInstall'],
    advanced: ['features', 'fileDenylistText', 'forceOutgoingIp', 'scriptIsPrivileged'],
};

const IMPLEMENTED_FEATURES = ['eula'] as const;

export default function EggEditorPage() {
    useWideContent();
    const { nestId, eggId } = useParams<{ nestId: string; eggId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);
    const isCreate = !eggId;

    const { data: egg, isLoading, isError } = useQuery({
        queryKey: ['admin', 'egg', eggId],
        queryFn: () => getEggDetail(Number(eggId)),
        enabled: !isCreate,
    });

    const [tab, setTab] = useState<TabId>('about');
    const [form, setForm] = useState<EggForm>(CREATE_DEFAULTS);
    const [baseline, setBaseline] = useState<EggForm>(CREATE_DEFAULTS);
    const [savingTab, setSavingTab] = useState<TabId | null>(null);
    const [creating, setCreating] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Initialize the draft only when a different egg loads — so per-tab saves and
    // the variables refetch don't wipe unsaved edits in other tabs.
    const initializedFor = useRef<number | null>(null);
    useEffect(() => {
        if (isCreate || !egg) return;
        if (initializedFor.current === egg.id) return;
        initializedFor.current = egg.id;
        const next = formFromEgg(egg);
        setForm(next);
        setBaseline(next);
    }, [egg, isCreate]);

    const patch = (p: Partial<EggForm>) => setForm(prev => ({ ...prev, ...p }));

    const tabDirty = (id: Exclude<TabId, 'variables'>): boolean => {
        return TAB_KEYS[id].some(k => JSON.stringify(form[k]) !== JSON.stringify(baseline[k]));
    };

    const saveTab = async (id: Exclude<TabId, 'variables'>) => {
        if (isCreate || !egg) return;
        setSavingTab(id);
        try {
            const payload = fullPayload(form);
            // Only send this tab's slice so a stale field elsewhere isn't written.
            const subset: Partial<EggPayload> = {};
            if (id === 'about') {
                Object.assign(subset, {
                    name: payload.name,
                    description: payload.description,
                    updateUrl: payload.updateUrl,
                    startup: payload.startup,
                    configStop: payload.configStop,
                    configStartup: payload.configStartup,
                    configFiles: payload.configFiles,
                });
            } else if (id === 'docker') {
                subset.dockerImages = payload.dockerImages;
            } else if (id === 'install') {
                subset.scriptContainer = payload.scriptContainer;
                subset.scriptEntry = payload.scriptEntry;
                subset.scriptInstall = payload.scriptInstall;
            } else if (id === 'advanced') {
                subset.features = payload.features;
                subset.fileDenylist = payload.fileDenylist;
                subset.forceOutgoingIp = payload.forceOutgoingIp;
                subset.scriptIsPrivileged = payload.scriptIsPrivileged;
            }
            await updateEgg(egg.id, subset);
            setBaseline(prev => {
                const next = { ...prev };
                for (const k of TAB_KEYS[id]) (next as Record<string, unknown>)[k] = form[k];
                return next;
            });
            push({ type: 'success', message: m['admin.nests.egg.saved']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSavingTab(null);
        }
    };

    const create = async () => {
        if (!nestId) return;
        const hasImage = Object.keys(dockerRowsToMap(form.dockerRows)).length > 0;
        if (!form.name.trim() || !form.startup.trim() || !hasImage) {
            push({ type: 'error', message: m['admin.nests.egg.createValidation']() });
            return;
        }
        setCreating(true);
        try {
            const created = await createEgg(Number(nestId), fullPayload(form));
            queryClient.invalidateQueries({ queryKey: ['admin', 'nests'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'nest-eggs', Number(nestId)] });
            push({ type: 'success', message: m['admin.nests.egg.created']() });
            navigate(`/admin/nests/${nestId}/eggs/${created.id}`);
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setCreating(false);
        }
    };

    const remove = async () => {
        if (!egg) return;
        setDeleting(true);
        try {
            await deleteEgg(egg.id);
            queryClient.invalidateQueries({ queryKey: ['admin', 'nests'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'nest-eggs', Number(nestId)] });
            push({ type: 'success', message: m['admin.nests.egg.deleted']() });
            navigate(`/admin/nests/${nestId}`);
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            setDeleting(false);
            setShowDelete(false);
        }
    };

    const onVariablesChanged = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'egg', eggId] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'nest-eggs', Number(nestId)] });
    };

    if (!isCreate && isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (!isCreate && (isError || !egg)) {
        return (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                {m['admin.nests.egg.loadError']()}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div>
                <button
                    onClick={() => navigate(`/admin/nests/${nestId}`)}
                    className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                >
                    <ArrowLeft className="h-4 w-4" /> {m['admin.nests.egg.back']()}
                </button>

                <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-semibold text-[var(--color-ink)]">
                            {isCreate ? m['admin.nests.egg.newTitle']() : egg!.name}
                        </h1>
                        {!isCreate && (
                            <p className="truncate font-mono text-xs text-[var(--color-ink-faint)]">{egg!.uuid}</p>
                        )}
                    </div>
                    {!isCreate && (
                        <div className="ml-auto flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
                                <Download className="h-4 w-4" /> {m['admin.nests.egg.exportAction']()}
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => setShowDelete(true)}>
                                <Trash2 className="h-4 w-4" /> {m['common.actions.delete']()}
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Stat row (edit only) */}
            {!isCreate && egg && (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {[
                        { label: m['admin.nests.egg.stat.id'](), value: String(egg.id) },
                        { label: m['admin.nests.egg.stat.uuid'](), value: egg.uuid, mono: true },
                        { label: m['admin.nests.egg.stat.author'](), value: egg.author },
                        { label: m['admin.nests.egg.stat.servers'](), value: String(egg.serverCount) },
                    ].map(stat => (
                        <div
                            key={stat.label}
                            className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3"
                        >
                            <p className="mb-1 text-xs uppercase tracking-widest text-[var(--color-ink-faint)]">{stat.label}</p>
                            <p className={cn('truncate text-sm text-[var(--color-ink)]', stat.mono && 'font-mono')}>{stat.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Tab bar */}
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                            tab === t.id
                                ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
                                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        <t.icon className="h-3.5 w-3.5" />
                        {td(t.labelKey)}
                    </button>
                ))}
            </div>

            {/* Tab body */}
            <div>
                {tab === 'about' && <AboutTab form={form} patch={patch} />}
                {tab === 'docker' && (
                    <DockerImageManager rows={form.dockerRows} onChange={rows => patch({ dockerRows: rows })} />
                )}
                {tab === 'variables' &&
                    (isCreate ? (
                        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/30 px-6 py-12 text-center text-sm text-[var(--color-ink-faint)]">
                            {m['admin.nests.egg.variables.createFirst']()}
                        </div>
                    ) : (
                        <VariablesTab eggId={egg!.id} variables={egg!.variables} onChanged={onVariablesChanged} />
                    ))}
                {tab === 'install' && <InstallTab form={form} patch={patch} />}
                {tab === 'advanced' && <AdvancedTab form={form} patch={patch} />}
            </div>

            {/* Save bar */}
            {isCreate ? (
                <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-5 py-3 shadow-2xl shadow-black/30 backdrop-blur">
                    <Button size="sm" onClick={create} disabled={creating}>
                        {creating ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                        {m['admin.nests.egg.createAction']()}
                    </Button>
                </div>
            ) : (
                tab !== 'variables' && (
                    <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-5 py-3 shadow-2xl shadow-black/30 backdrop-blur">
                        <span
                            className={cn(
                                'flex items-center gap-2 text-xs',
                                tabDirty(tab as Exclude<TabId, 'variables'>)
                                    ? 'text-[var(--color-warning)]'
                                    : 'text-[var(--color-ink-faint)]',
                            )}
                        >
                            <span
                                className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    tabDirty(tab as Exclude<TabId, 'variables'>)
                                        ? 'bg-[var(--color-warning)]'
                                        : 'bg-[var(--color-ink-faint)]',
                                )}
                            />
                            {tabDirty(tab as Exclude<TabId, 'variables'>)
                                ? m['common.editor.unsaved']()
                                : m['common.editor.allSaved']()}
                        </span>
                        <Button
                            size="sm"
                            onClick={() => saveTab(tab as Exclude<TabId, 'variables'>)}
                            disabled={!tabDirty(tab as Exclude<TabId, 'variables'>) || savingTab !== null}
                        >
                            {savingTab === tab ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                            {m['common.actions.saveChanges']()}
                        </Button>
                    </div>
                )
            )}

            {showExport && egg && <ExportEggModal eggId={egg.id} onClose={() => setShowExport(false)} />}

            <ConfirmDialog
                open={showDelete}
                onClose={() => setShowDelete(false)}
                title={m['admin.nests.egg.delete.title']()}
                body={m['admin.nests.egg.delete.body']()}
                confirmLabel={m['admin.nests.egg.delete.confirm']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={deleting}
                onConfirm={remove}
            />
        </div>
    );
}

// ─── About tab ────────────────────────────────────────────────────────────────

function AboutTab({ form, patch }: { form: EggForm; patch: (p: Partial<EggForm>) => void }) {
    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 xl:grid-cols-2">
                <Field label={m['admin.nests.egg.about.name']()} htmlFor="egg-name">
                    <Input id="egg-name" value={form.name} onChange={e => patch({ name: e.currentTarget.value })} />
                </Field>
                <Field label={m['common.labels.description']()} htmlFor="egg-desc">
                    <Input id="egg-desc" value={form.description} onChange={e => patch({ description: e.currentTarget.value })} />
                </Field>
                <Field label={m['admin.nests.egg.about.stopCommand']()} htmlFor="egg-stop">
                    <Input id="egg-stop" value={form.configStop} onChange={e => patch({ configStop: e.currentTarget.value })} />
                </Field>
                <Field label={m['admin.nests.egg.about.updateUrl']()} htmlFor="egg-updateurl">
                    <Input id="egg-updateurl" value={form.updateUrl} onChange={e => patch({ updateUrl: e.currentTarget.value })} />
                </Field>
            </div>

            <Field label={m['admin.nests.egg.about.startup']()} htmlFor="egg-startup">
                <Input id="egg-startup" className="font-mono" value={form.startup} onChange={e => patch({ startup: e.currentTarget.value })} />
            </Field>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-[var(--color-ink-muted)]">
                        {m['admin.nests.egg.about.configStartup']()}
                    </label>
                    <CodeEditor value={form.configStartup} onChange={v => patch({ configStartup: v })} language="JSON" height="14rem" />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-[var(--color-ink-muted)]">
                        {m['admin.nests.egg.about.configFiles']()}
                    </label>
                    <CodeEditor value={form.configFiles} onChange={v => patch({ configFiles: v })} language="JSON" height="14rem" />
                </div>
            </div>
            <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.nests.egg.about.processHint']()}</p>
        </div>
    );
}

// ─── Install tab ──────────────────────────────────────────────────────────────

function InstallTab({ form, patch }: { form: EggForm; patch: (p: Partial<EggForm>) => void }) {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--color-ink-muted)]">
                    {m['admin.nests.egg.install.script']()}
                </label>
                <CodeEditor value={form.scriptInstall} onChange={v => patch({ scriptInstall: v })} language="Shell" height="22rem" />
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
                <Field
                    label={m['admin.nests.egg.install.container']()}
                    hint={m['admin.nests.egg.install.containerHint']()}
                    htmlFor="egg-scriptcontainer"
                >
                    <Input
                        id="egg-scriptcontainer"
                        className="font-mono"
                        value={form.scriptContainer}
                        onChange={e => patch({ scriptContainer: e.currentTarget.value })}
                    />
                </Field>
                <Field
                    label={m['admin.nests.egg.install.entrypoint']()}
                    hint={m['admin.nests.egg.install.entrypointHint']()}
                    htmlFor="egg-scriptentry"
                >
                    <Input
                        id="egg-scriptentry"
                        className="font-mono"
                        value={form.scriptEntry}
                        onChange={e => patch({ scriptEntry: e.currentTarget.value })}
                    />
                </Field>
            </div>
        </div>
    );
}

// ─── Advanced tab ─────────────────────────────────────────────────────────────

function AdvancedTab({ form, patch }: { form: EggForm; patch: (p: Partial<EggForm>) => void }) {
    const toggleFeature = (feature: string) => {
        patch({
            features: form.features.includes(feature)
                ? form.features.filter(f => f !== feature)
                : [...form.features, feature],
        });
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--color-ink-muted)]">
                    {m['admin.nests.egg.advanced.features']()}
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {IMPLEMENTED_FEATURES.map(feature => {
                        const on = form.features.includes(feature);
                        return (
                            <button
                                key={feature}
                                type="button"
                                onClick={() => toggleFeature(feature)}
                                className={cn(
                                    'rounded-[var(--radius-card)] border px-4 py-3 text-left transition-colors',
                                    on
                                        ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5'
                                        : 'border-[var(--color-border)] bg-[var(--color-surface-2)]/40 hover:border-[var(--color-border-strong)]',
                                )}
                            >
                                <div className="text-sm font-medium text-[var(--color-ink)]">
                                    {td(`admin.nests.egg.advanced.feature.${feature}.name`)}
                                </div>
                                <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
                                    {td(`admin.nests.egg.advanced.feature.${feature}.desc`)}
                                </div>
                                <div className={cn('mt-2 text-xs', on ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]')}>
                                    {on ? m['common.states.enabled']() : m['common.states.disabled']()}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3">
                    <span className="text-sm text-[var(--color-ink)]">{m['admin.nests.egg.advanced.forceOutgoingIp']()}</span>
                    <Switch
                        checked={form.forceOutgoingIp}
                        onChange={v => patch({ forceOutgoingIp: v })}
                        label={m['admin.nests.egg.advanced.forceOutgoingIp']()}
                    />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3">
                    <span className="text-sm text-[var(--color-ink)]">{m['admin.nests.egg.advanced.privileged']()}</span>
                    <Switch
                        checked={form.scriptIsPrivileged}
                        onChange={v => patch({ scriptIsPrivileged: v })}
                        label={m['admin.nests.egg.advanced.privileged']()}
                    />
                </label>
            </div>

            <Field
                label={m['admin.nests.egg.advanced.fileDenylist']()}
                hint={m['admin.nests.egg.advanced.fileDenylistHint']()}
                htmlFor="egg-denylist"
            >
                <Textarea
                    id="egg-denylist"
                    rows={6}
                    className="font-mono"
                    value={form.fileDenylistText}
                    onChange={e => patch({ fileDenylistText: e.currentTarget.value })}
                />
            </Field>
        </div>
    );
}
