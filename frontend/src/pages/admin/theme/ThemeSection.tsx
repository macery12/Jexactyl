import { m, td } from '@/i18n';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Palette,
    SwatchBook,
    Grid3x3,
    Sparkles,
    Sliders,
    RotateCcw,
    Save,
    Check,
    Plus,
    Trash2,
    ChevronDown,
    Lock,
} from 'lucide-react';
import {
    DEFAULT_THEME,
    BASE_PALETTES,
    BRAND_SWATCHES,
    THEME_TOKENS,
    RADIUS_VALUES,
    applyThemeVars,
    normalizeTheme,
    type Theme,
    type ThemeColorKey,
    type ThemeColors,
    type RadiusKey,
    type BaseColorKey,
} from '@/lib/theme';
import {
    getPresets,
    updateColor,
    updateFeel,
    resetTheme,
    savePreset,
    deletePreset,
    type ThemePreset,
} from '@/api/theme';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { ThemePreview } from './ThemePreview';

type ColorMeta = (typeof THEME_TOKENS)[number];

const BASE_KEYS: BaseColorKey[] = ['canvas', 'surface', 'surface_2', 'border', 'ink', 'ink_muted'];
const STATUS_KEYS: ThemeColorKey[] = ['accent', 'warning', 'danger'];
const RADII: RadiusKey[] = ['sharp', 'soft', 'round'];

// Keep window.ThemeConfiguration in sync with the committed theme so anything
// re-reading it (or a soft remount) stays consistent without a full reload.
function syncWindow(theme: Theme): void {
    window.ThemeConfiguration = { colors: { ...theme.colors }, feel: { ...theme.feel } };
}

export default function ThemeSection() {
    const qc = useQueryClient();
    const initial = useMemo(() => normalizeTheme(window.ThemeConfiguration), []);
    const [saved, setSaved] = useState<Theme>(initial);
    const [draft, setDraft] = useState<Theme>(initial);
    const [advanced, setAdvanced] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    const presetsQ = useQuery({ queryKey: ['admin', 'theme', 'presets'], queryFn: getPresets });

    const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

    const setColor = (key: ThemeColorKey, value: string) =>
        setDraft(d => ({ ...d, colors: { ...d.colors, [key]: value } }));
    const setFeelValue = <K extends keyof Theme['feel']>(key: K, value: Theme['feel'][K]) =>
        setDraft(d => ({ ...d, feel: { ...d.feel, [key]: value } }));
    const applyBasePalette = (colors: Record<BaseColorKey, string>) =>
        setDraft(d => ({ ...d, colors: { ...d.colors, ...colors } }));
    const loadPresetColors = (colors: Partial<ThemeColors>) =>
        setDraft(d => ({ ...d, colors: { ...d.colors, ...colors } }));

    const note = (msg: string) => {
        setFlash(msg);
        window.setTimeout(() => setFlash(null), 2400);
    };

    // Persist only the keys that changed against the last committed theme.
    async function persist(next: Theme): Promise<void> {
        const tasks: Promise<unknown>[] = [];
        for (const key of Object.keys(next.colors) as ThemeColorKey[]) {
            if (next.colors[key] !== saved.colors[key]) tasks.push(updateColor(key, next.colors[key]));
        }
        for (const key of Object.keys(next.feel) as (keyof Theme['feel'])[]) {
            if (next.feel[key] !== saved.feel[key]) tasks.push(updateFeel(key, next.feel[key]));
        }
        await Promise.all(tasks);
    }

    function commitLocally(next: Theme): void {
        setSaved(next);
        setDraft(next);
        applyThemeVars(next); // apply globally so the live app updates without reload
        syncWindow(next);
    }

    const onSave = async () => {
        setBusy(true);
        try {
            await persist(draft);
            commitLocally(draft);
            note(m['admin.theme.flash.saved']());
        } catch {
            note(m['admin.theme.flash.saveError']());
        } finally {
            setBusy(false);
        }
    };

    const onResetDefaults = async () => {
        setBusy(true);
        try {
            await resetTheme();
            commitLocally(DEFAULT_THEME);
            note(m['admin.theme.flash.reset']());
        } catch {
            note(m['admin.theme.flash.resetError']());
        } finally {
            setBusy(false);
        }
    };

    const onSaveAsPreset = async () => {
        const name = presetName.trim();
        if (!name) return;
        setBusy(true);
        try {
            if (dirty) {
                await persist(draft);
                commitLocally(draft);
            }
            await savePreset(name);
            setPresetName('');
            await qc.invalidateQueries({ queryKey: ['admin', 'theme', 'presets'] });
            note(m['admin.theme.flash.presetSaved']({ name }));
        } catch {
            note(m['admin.theme.flash.presetSaveError']());
        } finally {
            setBusy(false);
        }
    };

    const onDeletePreset = async (preset: ThemePreset) => {
        try {
            await deletePreset(preset.id);
            await qc.invalidateQueries({ queryKey: ['admin', 'theme', 'presets'] });
        } catch {
            note(m['admin.theme.flash.presetDeleteError']());
        }
    };

    const tokenMeta = (key: ThemeColorKey): ColorMeta | undefined => THEME_TOKENS.find(tk => tk.key === key);
    // Translate token label/description by key, falling back to the registry's
    // English copy in lib/theme.ts if a locale hasn't translated it yet.
    const tokenLabel = (key: ThemeColorKey) => td(`admin.theme.tokens.${key}.label`, tokenMeta(key)?.label ?? key);
    const tokenDesc = (key: ThemeColorKey) => td(`admin.theme.tokens.${key}.description`, tokenMeta(key)?.description ?? '');
    const activeBasePalette = BASE_PALETTES.find(p => BASE_KEYS.every(k => p.colors[k] === draft.colors[k]));

    return (
        <div className="relative flex flex-col gap-4">
            <div className="bg-grid pointer-events-none absolute inset-x-0 -top-6 h-72 -z-10 opacity-60" />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{m['admin.theme.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {m['admin.theme.subtitle']()}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {flash && (
                        <span className="text-xs text-[var(--color-ink-muted)]">{flash}</span>
                    )}
                    <button
                        onClick={onResetDefaults}
                        disabled={busy}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-4 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                    >
                        <RotateCcw className="h-4 w-4" /> {m['admin.theme.reset']()}
                    </button>
                    {dirty && (
                        <button
                            onClick={() => setDraft(saved)}
                            disabled={busy}
                            className="inline-flex h-10 items-center px-2 text-sm text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-muted)]"
                        >
                            {m['admin.theme.revert']()}
                        </button>
                    )}
                    <button
                        onClick={onSave}
                        disabled={busy || !dirty}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50"
                    >
                        {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} {m['common.actions.saveChanges']()}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(360px,440px)]">
                {/* Controls */}
                <div className="flex min-w-0 flex-col gap-4">
                    {/* Brand */}
                    <Panel title={m['admin.theme.brand']()} icon={Palette}>
                        <p className="mb-3 text-xs text-[var(--color-ink-muted)]">{tokenDesc('primary')}</p>
                        <div className="flex flex-wrap gap-2">
                            {BRAND_SWATCHES.map(s => (
                                <button
                                    key={s.hex}
                                    title={s.name}
                                    onClick={() => setColor('primary', s.hex)}
                                    className={cn(
                                        'h-9 w-9 rounded-lg border transition-transform hover:scale-105',
                                        draft.colors.primary.toLowerCase() === s.hex.toLowerCase()
                                            ? 'border-[var(--color-ink)] ring-2 ring-[var(--brand)]'
                                            : 'border-black/30',
                                    )}
                                    style={{ background: s.hex }}
                                >
                                    {draft.colors.primary.toLowerCase() === s.hex.toLowerCase() && (
                                        <Check className="mx-auto h-4 w-4 text-[var(--color-brand-ink)] drop-shadow" />
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="mt-3">
                            <ColorField label={m['admin.theme.custom']()} value={draft.colors.primary} onChange={v => setColor('primary', v)} />
                        </div>
                    </Panel>

                    {/* Base palette */}
                    <Panel title={m['admin.theme.basePalette']()} icon={SwatchBook}>
                        <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                            {m['admin.theme.basePaletteDesc']()}
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {BASE_PALETTES.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => applyBasePalette(p.colors)}
                                    className={cn(
                                        'flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                                        activeBasePalette?.id === p.id
                                            ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                                            : 'border-[var(--color-border-strong)] hover:border-[var(--color-ink-faint)]',
                                    )}
                                >
                                    <div className="flex -space-x-1">
                                        {BASE_KEYS.slice(0, 4).map(k => (
                                            <span
                                                key={k}
                                                className="h-5 w-5 rounded-full border border-black/40"
                                                style={{ background: p.colors[k] }}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-sm font-medium">{p.name}</span>
                                    {activeBasePalette?.id === p.id && (
                                        <Check className="ml-auto h-4 w-4 text-[var(--brand)]" />
                                    )}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setAdvanced(a => !a)}
                            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                        >
                            <Sliders className="h-3.5 w-3.5" />
                            {m['admin.theme.advanced']()}
                            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')} />
                        </button>

                        {advanced && (
                            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
                                {BASE_KEYS.map(k => (
                                    <ColorField
                                        key={k}
                                        label={tokenLabel(k)}
                                        description={tokenDesc(k)}
                                        value={draft.colors[k]}
                                        onChange={v => setColor(k, v)}
                                    />
                                ))}
                            </div>
                        )}
                    </Panel>

                    {/* Status */}
                    <Panel title={m['admin.theme.status']()} icon={Sparkles}>
                        <div className="flex flex-col gap-2">
                            {STATUS_KEYS.map(k => (
                                <ColorField
                                    key={k}
                                    label={tokenLabel(k)}
                                    description={tokenDesc(k)}
                                    value={draft.colors[k]}
                                    onChange={v => setColor(k, v)}
                                />
                            ))}
                        </div>
                    </Panel>

                    {/* Feel */}
                    <Panel title={m['admin.theme.feel']()} icon={Grid3x3}>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium text-[var(--color-ink-muted)]">{m['admin.theme.cornerRadius']()}</span>
                                <Segmented
                                    options={RADII.map(r => ({ value: r, label: td(`admin.theme.radius.${r}`) }))}
                                    value={draft.feel.radius}
                                    onChange={v => setFeelValue('radius', v)}
                                />
                            </div>

                            <div className="border-t border-[var(--color-border)] pt-3">
                                <Toggle
                                    label={m['admin.theme.grid']()}
                                    description={m['admin.theme.gridDesc']()}
                                    checked={draft.feel.grid_enabled}
                                    onChange={v => setFeelValue('grid_enabled', v)}
                                />
                                {draft.feel.grid_enabled && (
                                    <div className="mt-3 flex flex-col gap-3">
                                        <Slider
                                            label={m['admin.theme.lineStrength']()}
                                            min={0}
                                            max={100}
                                            value={draft.feel.grid_opacity}
                                            suffix="%"
                                            onChange={v => setFeelValue('grid_opacity', v)}
                                        />
                                        <Slider
                                            label={m['admin.theme.cellSize']()}
                                            min={12}
                                            max={64}
                                            value={draft.feel.grid_size}
                                            suffix="px"
                                            onChange={v => setFeelValue('grid_size', v)}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-[var(--color-border)] pt-3">
                                <Toggle
                                    label={m['admin.theme.aurora']()}
                                    description={m['admin.theme.auroraDesc']()}
                                    checked={draft.feel.aurora_enabled}
                                    onChange={v => setFeelValue('aurora_enabled', v)}
                                />
                                {draft.feel.aurora_enabled && (
                                    <div className="mt-3">
                                        <Slider
                                            label={m['admin.theme.intensity']()}
                                            min={0}
                                            max={100}
                                            value={draft.feel.aurora_intensity}
                                            suffix="%"
                                            onChange={v => setFeelValue('aurora_intensity', v)}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </Panel>

                    {/* Presets */}
                    <Panel title={m['admin.theme.presets']()} icon={SwatchBook}>
                        <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                            {m['admin.theme.presetsDesc']()}
                        </p>
                        {presetsQ.isLoading ? (
                            <div className="flex justify-center py-6">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {(presetsQ.data ?? []).map(p => (
                                    <div
                                        key={p.id}
                                        className="group flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] p-2.5"
                                    >
                                        <div className="flex -space-x-1">
                                            {(['primary', 'surface', 'accent', 'danger'] as const).map(k => (
                                                <span
                                                    key={k}
                                                    className="h-5 w-5 rounded-full border border-black/40"
                                                    style={{ background: p.colors[k] ?? '#000' }}
                                                />
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => loadPresetColors(p.colors)}
                                            className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-[var(--brand)]"
                                            title={m['admin.theme.loadPreset']({ name: p.name })}
                                        >
                                            {p.name}
                                        </button>
                                        {p.is_builtin ? (
                                            <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                                        ) : (
                                            <button
                                                onClick={() => onDeletePreset(p)}
                                                className="shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
                                                title={m['admin.theme.deletePreset']()}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
                            <input
                                value={presetName}
                                onChange={e => setPresetName(e.target.value)}
                                placeholder={m['admin.theme.newPresetName']()}
                                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/60"
                            />
                            <button
                                onClick={onSaveAsPreset}
                                disabled={busy || !presetName.trim()}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                            >
                                <Plus className="h-3.5 w-3.5" /> {m['admin.theme.saveCurrent']()}
                            </button>
                        </div>
                    </Panel>
                </div>

                {/* Sticky live preview */}
                <div className="lg:sticky lg:top-4 lg:self-start">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                        <Palette className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" /> {m['admin.theme.livePreview']()}
                        {dirty && <span className="text-[var(--color-warning)]">{m['admin.theme.unsaved']()}</span>}
                    </div>
                    <ThemePreview theme={draft} />
                    <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                        {m['admin.theme.previewMeta']({ radius: RADIUS_VALUES[draft.feel.radius], grid: draft.feel.grid_enabled ? `${draft.feel.grid_opacity}%` : m['admin.theme.off'](), aurora: draft.feel.aurora_enabled ? `${draft.feel.aurora_intensity}%` : m['admin.theme.off']() })}
                    </p>
                </div>
            </div>
        </div>
    );
}

// ── small controls ──────────────────────────────────────────────────────────

function ColorField({
    label,
    description,
    value,
    onChange,
}: {
    label: string;
    description?: string;
    value: string;
    onChange: (v: string) => void;
}) {
    const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
    return (
        <div className="flex items-center gap-3">
            <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
                <span className="absolute inset-0" style={{ background: value }} />
                <input
                    type="color"
                    value={safe}
                    onChange={e => onChange(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                />
            </label>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">{label}</p>
                {description && <p className="truncate text-xs text-[var(--color-ink-faint)]">{description}</p>}
            </div>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                spellCheck={false}
                className="h-9 w-28 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 font-mono text-xs uppercase tabular-nums text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/60"
            />
        </div>
    );
}

function Toggle({
    label,
    description,
    checked,
    onChange,
}: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <button onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 text-left">
            <span
                className={cn(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                    checked ? 'bg-[var(--brand)]' : 'bg-[var(--color-surface-2)] border border-[var(--color-border-strong)]',
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                        checked ? 'left-[1.125rem]' : 'left-0.5',
                    )}
                />
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                {description && <span className="block text-xs text-[var(--color-ink-faint)]">{description}</span>}
            </span>
        </button>
    );
}

function Slider({
    label,
    min,
    max,
    value,
    suffix,
    onChange,
}: {
    label: string;
    min: number;
    max: number;
    value: number;
    suffix?: string;
    onChange: (v: number) => void;
}) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-ink-muted)]">{label}</span>
                <span className="font-mono tabular-nums text-[var(--color-ink-faint)]">
                    {value}
                    {suffix}
                </span>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-2)] accent-[var(--brand)]"
            />
        </label>
    );
}

function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
}) {
    return (
        <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
            {options.map(o => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        value === o.value
                            ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
