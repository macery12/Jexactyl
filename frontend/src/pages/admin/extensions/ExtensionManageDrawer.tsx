import { m, td } from '@/i18n/messages';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ExternalLink, Download, ArrowUpCircle, Trash2, AlertTriangle, Settings2, ShieldCheck } from 'lucide-react';
import {
    type Extension,
    type ExtensionSettingField,
    type NestOption,
    type EggOption,
    updateExtension,
    installExtension,
    updateExtensionPackage,
    uninstallExtension,
} from '@/api/extensions';
import { Switch } from '@/components/ui/Switch';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { cn } from '@/lib/cn';
import { resolveExtensionIcon, extensionTone, toneVar, toneLabelKey } from './extMeta';
import { DatabaseChangesModal } from './DatabaseChangesModal';
import type { DatabasePlanOperation } from '@/api/extensions';

const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;

// Toggle a numeric id within a selection list (immutable).
const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id];

export function ExtensionManageDrawer({
    ext,
    nests,
    eggs,
    locked,
    onClose,
}: {
    ext: Extension | null;
    nests: NestOption[];
    eggs: EggOption[];
    locked: boolean;
    onClose: () => void;
}) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [enabled, setEnabled] = useState(false);
    const [settings, setSettings] = useState<Record<string, unknown>>({});
    const [allowedNests, setAllowedNests] = useState<number[]>([]);
    const [allowedEggs, setAllowedEggs] = useState<number[]>([]);
    // Which database-changes review modal is open (null = none). The install,
    // update, and uninstall actions all route through it before committing.
    const [dbModal, setDbModal] = useState<DatabasePlanOperation | null>(null);

    // Re-seed local form state whenever a different extension is opened.
    useEffect(() => {
        if (!ext) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setEnabled(ext.enabled);
        setSettings({ ...ext.settings });
        setAllowedNests([...ext.allowedNests]);
        setAllowedEggs([...ext.allowedEggs]);
        setDbModal(null);
    }, [ext]);

    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
    const fail = () => push({ type: 'error', message: m['common.states.genericError']() });

    const save = useMutation({
        mutationFn: () => updateExtension(ext!.id, { enabled, allowedNests, allowedEggs, settings }),
        onSuccess: e => {
            push({ type: 'success', message: m['extensions.toast.saved']({ name: e.name }) });
            invalidate();
        },
        onError: fail,
    });

    const install = useMutation({
        mutationFn: () => installExtension(ext!.id, ext!.source.repositoryId!, ext!.latestVersion),
        onSuccess: e => {
            push({ type: 'success', message: m['extensions.toast.installed']({ name: e.name }) });
            invalidate();
            onClose();
        },
        onError: fail,
    });

    const updatePkg = useMutation({
        mutationFn: () => updateExtensionPackage(ext!.id, ext!.source.repositoryId!, ext!.latestVersion),
        onSuccess: e => {
            push({ type: 'success', message: m['extensions.toast.updated']({ name: e.name }) });
            invalidate();
            onClose();
        },
        onError: fail,
    });

    const remove = useMutation({
        mutationFn: (vars: { dropData: boolean; confirm?: string }) =>
            uninstallExtension(ext!.id, vars.dropData, vars.confirm),
        onSuccess: res => {
            push({ type: 'success', message: m['extensions.toast.uninstalled']({ name: res.extension.name ?? ext!.id }) });
            if (res.dataDropped) {
                push({ type: 'success', message: m['extensions.toast.dataDropped']() });
            } else if (res.preservedTables.length > 0) {
                push({ type: 'info', message: m['extensions.toast.dataPreserved']({ tables: res.preservedTables.join(', ') }) });
            }
            invalidate();
            onClose();
        },
        onError: fail,
    });

    const eggsByNest = useMemo(() => {
        const map = new Map<number, EggOption[]>();
        for (const egg of eggs) {
            const list = map.get(egg.nestId) ?? [];
            list.push(egg);
            map.set(egg.nestId, list);
        }
        return map;
    }, [eggs]);

    const open = ext !== null;
    const busy = save.isPending || install.isPending || updatePkg.isPending || remove.isPending;

    return (
        <>
            {/* backdrop */}
            <div
                className={cn(
                    'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
                    open ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
                onClick={onClose}
                aria-hidden
            />

            {/* panel */}
            <aside
                className={cn(
                    'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl transition-transform duration-200',
                    open ? 'translate-x-0' : 'translate-x-full',
                )}
                role="dialog"
                aria-modal="true"
            >
                {ext && DrawerBody()}
            </aside>
        </>
    );

    // Rendered as a nested component so it only mounts with a non-null ext, which
    // keeps the hooks above unconditional while the body can assume `ext` exists.
    function DrawerBody() {
        const e = ext!;
        const Icon = resolveExtensionIcon(e.icon);
        const tone = extensionTone(e);
        const accent = toneVar(tone);

        return (
            <>
                <header className="flex items-start gap-3 border-b border-[var(--color-border)] p-4">
                    <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"
                        style={{ background: tint(accent, 12), borderColor: tint(accent, 30), color: accent }}
                    >
                        <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h2 className="truncate text-base font-semibold text-[var(--color-ink)]">{e.name}</h2>
                            <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                v{e.version}
                            </span>
                        </div>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
                            {e.source.official && <ShieldCheck className="h-3.5 w-3.5 text-[var(--brand)]" />}
                            <span className="truncate">
                                {e.source.type === 'core' ? m['extensions.drawer.sourceCore']() : e.source.label}
                            </span>
                            <span className="text-[var(--color-ink-faint)]">·</span>
                            <span style={{ color: accent }}>{td(`extensions.${toneLabelKey(tone)}`)}</span>
                            <span className="text-[var(--color-ink-faint)]">·</span>
                            <span className="rounded border border-[var(--color-border)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                                {td(`extensions.type.${e.type}`)}
                            </span>
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={m['common.actions.close']()}
                        className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
                    <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{e.description}</p>

                    {/* manifest-supplied security note (rendered verbatim, not catalogued) */}
                    {e.source.securityWarning && (
                        <div
                            className="flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
                            style={{
                                background: tint('var(--color-warning)', 10),
                                borderColor: tint('var(--color-warning)', 30),
                                color: 'var(--color-warning)',
                            }}
                        >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{e.source.securityWarning}</span>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-ink-faint)]">
                        <span>
                            {m['extensions.drawer.compatible']()}:{' '}
                            <span className="font-mono text-[var(--color-ink-muted)]">
                                {e.compatiblePanelVersions.length > 0
                                    ? e.compatiblePanelVersions.join(', ')
                                    : m['extensions.drawer.anyVersion']()}
                            </span>
                        </span>
                        {e.source.homepageUrl && (
                            <a
                                href={e.source.homepageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
                            >
                                <ExternalLink className="h-3 w-3" />
                                {m['extensions.drawer.homepage']()}
                            </a>
                        )}
                    </div>

                    {e.installable && e.compatible === false && (
                        <div
                            className="flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
                            style={{
                                background: tint('var(--color-danger)', 10),
                                borderColor: tint('var(--color-danger)', 30),
                                color: 'var(--color-danger)',
                            }}
                        >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{m['extensions.drawer.incompatibleNote']()}</span>
                        </div>
                    )}

                    {e.installable ? null : (
                        <>
                            {/* enable */}
                            <Section icon={Settings2} title={m['extensions.drawer.enableTitle']()}>
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
                                    <span className="text-xs text-[var(--color-ink-muted)]">{m['extensions.drawer.enableHint']()}</span>
                                    <Switch checked={enabled} onChange={setEnabled} disabled={busy} />
                                </div>
                            </Section>

                            {/* settings schema */}
                            <Section title={m['extensions.drawer.settings']()}>
                                {e.settingsSchema.length === 0 ? (
                                    <p className="text-xs text-[var(--color-ink-faint)]">{m['extensions.drawer.noSettings']()}</p>
                                ) : (
                                    <div className="space-y-3">
                                        {e.settingsSchema.map(field => (
                                            <SettingFieldRow
                                                key={field.key}
                                                field={field}
                                                value={settings[field.key] ?? field.default}
                                                disabled={busy}
                                                onChange={v => setSettings(s => ({ ...s, [field.key]: v }))}
                                            />
                                        ))}
                                    </div>
                                )}
                            </Section>

                            {/* access control — only meaningful for extensions with a
                                per-server surface; admin-only extensions have no eggs/nests. */}
                            {e.hasServerPage && (
                            <Section title={m['extensions.drawer.access']()}>
                                <p className="-mt-1 mb-2 text-[11px] text-[var(--color-ink-faint)]">{m['extensions.drawer.accessHint']()}</p>
                                <div className="space-y-3">
                                    <div>
                                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                                            {m['extensions.drawer.nests']()}
                                        </p>
                                        <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-2">
                                            {nests.length === 0 && (
                                                <p className="px-1 text-xs text-[var(--color-ink-faint)]">{m['extensions.drawer.allNests']()}</p>
                                            )}
                                            {nests.map(n => (
                                                <CheckRow
                                                    key={n.id}
                                                    label={n.name}
                                                    checked={allowedNests.includes(n.id)}
                                                    disabled={busy}
                                                    onChange={() => setAllowedNests(l => toggleId(l, n.id))}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                                            {m['extensions.drawer.eggs']()}
                                        </p>
                                        <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-2">
                                            {eggs.length === 0 && (
                                                <p className="px-1 text-xs text-[var(--color-ink-faint)]">{m['extensions.drawer.noEggs']()}</p>
                                            )}
                                            {nests.map(n => {
                                                const ne = eggsByNest.get(n.id) ?? [];
                                                if (ne.length === 0) return null;
                                                return (
                                                    <div key={n.id}>
                                                        <p className="px-1 py-0.5 text-[10px] font-medium text-[var(--color-ink-faint)]">
                                                            {n.name}
                                                        </p>
                                                        {ne.map(egg => (
                                                            <CheckRow
                                                                key={egg.id}
                                                                label={egg.name}
                                                                checked={allowedEggs.includes(egg.id)}
                                                                disabled={busy}
                                                                onChange={() => setAllowedEggs(l => toggleId(l, egg.id))}
                                                            />
                                                        ))}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </Section>
                            )}

                            {/* danger zone — uninstall opens the database-changes
                                review modal, which surfaces the tables that will be
                                dropped/preserved and hosts the typed-id data drop. */}
                            {e.canUninstall && (
                                <Section title={m['extensions.drawer.dangerZone']()}>
                                    <div
                                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                                        style={{ borderColor: tint('var(--color-danger)', 30) }}
                                    >
                                        <span className="text-xs text-[var(--color-ink-muted)]">{m['extensions.drawer.dangerHint']()}</span>
                                        <button
                                            type="button"
                                            disabled={busy || locked}
                                            onClick={() => setDbModal('uninstall')}
                                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/40 px-3 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
                                        >
                                            {remove.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                                            {remove.isPending ? m['extensions.drawer.uninstalling']() : m['extensions.drawer.uninstall']()}
                                        </button>
                                    </div>
                                </Section>
                            )}
                        </>
                    )}
                </div>

                {/* footer actions */}
                <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] p-4">
                    {e.installable ? (
                        e.compatible === false ? (
                            <button
                                type="button"
                                disabled
                                title={m['extensions.incompatible.blocked']()}
                                className="inline-flex h-10 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-[var(--color-danger)]/40 text-sm font-medium text-[var(--color-danger)]"
                            >
                                <AlertTriangle className="h-4 w-4" />
                                {m['extensions.status.incompatible']()}
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled={busy || locked || e.source.repositoryId == null}
                                onClick={() => setDbModal('install')}
                                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] text-sm font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50"
                            >
                                {install.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                                {install.isPending ? m['extensions.drawer.installing']() : m['extensions.drawer.installCta']()}
                            </button>
                        )
                    ) : (
                        <>
                            {e.updateAvailable && (
                                <button
                                    type="button"
                                    disabled={busy || locked || e.source.repositoryId == null}
                                    onClick={() => setDbModal('update')}
                                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-50"
                                    style={{
                                        borderColor: tint('var(--color-warning)', 40),
                                        color: 'var(--color-warning)',
                                        background: tint('var(--color-warning)', 10),
                                    }}
                                >
                                    {updatePkg.isPending ? <Spinner className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                                    {m['extensions.drawer.updateCta']({ version: e.latestVersion })}
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={busy || locked}
                                onClick={() => save.mutate()}
                                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] text-sm font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50"
                            >
                                {save.isPending && <Spinner className="h-4 w-4" />}
                                {save.isPending ? m['common.states.saving']() : m['common.actions.saveChanges']()}
                            </button>
                        </>
                    )}
                </footer>

                {dbModal && (
                    <DatabaseChangesModal
                        open
                        operation={dbModal}
                        busy={install.isPending || updatePkg.isPending || remove.isPending}
                        extensions={[
                            dbModal === 'uninstall'
                                ? { id: e.id, name: e.name }
                                : { id: e.id, name: e.name, repositoryId: e.source.repositoryId, version: e.latestVersion },
                        ]}
                        onClose={() => setDbModal(null)}
                        onConfirm={drops => {
                            if (dbModal === 'install') install.mutate();
                            else if (dbModal === 'update') updatePkg.mutate();
                            else remove.mutate({ dropData: drops.length > 0, confirm: drops[0]?.confirm });
                        }}
                    />
                )}
            </>
        );
    }
}

function Section({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon?: typeof Settings2;
    children: React.ReactNode;
}) {
    return (
        <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                {Icon && <Icon className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />}
                {title}
            </h3>
            {children}
        </section>
    );
}

function CheckRow({
    label,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={onChange}
                className="h-3.5 w-3.5 accent-[var(--brand)]"
            />
            <span className="truncate">{label}</span>
        </label>
    );
}

// Renders one manifest-defined settings field. Field labels/descriptions come
// from the manifest, so they are shown verbatim (not run through the catalog).
function SettingFieldRow({
    field,
    value,
    disabled,
    onChange,
}: {
    field: ExtensionSettingField;
    value: unknown;
    disabled?: boolean;
    onChange: (v: unknown) => void;
}) {
    const type = field.type.toLowerCase();

    if (type === 'boolean' || type === 'bool' || type === 'toggle') {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--color-ink)]">{field.label}</p>
                    {field.description && (
                        <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{field.description}</p>
                    )}
                </div>
                <Switch checked={Boolean(value)} disabled={disabled} onChange={onChange} />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-ink-muted)]">{field.label}</label>
            {type === 'textarea' ? (
                <textarea
                    rows={3}
                    disabled={disabled}
                    value={String(value ?? '')}
                    placeholder={field.placeholder}
                    onChange={ev => onChange(ev.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)] focus:border-[var(--color-focus)]"
                />
            ) : type === 'select' && field.options ? (
                <select
                    disabled={disabled}
                    value={String(value ?? '')}
                    onChange={ev => onChange(ev.target.value)}
                    className="h-10 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)] focus:border-[var(--color-focus)]"
                >
                    {field.options.map(o => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            ) : (
                <Input
                    type={type === 'number' ? 'number' : type === 'password' ? 'password' : 'text'}
                    disabled={disabled}
                    value={String(value ?? '')}
                    placeholder={field.placeholder}
                    onChange={ev => onChange(type === 'number' ? Number(ev.target.value) : ev.target.value)}
                />
            )}
            {field.description && type !== 'boolean' && (
                <span className="text-[11px] text-[var(--color-ink-faint)]">{field.description}</span>
            )}
        </div>
    );
}
