// Single source of truth for the V2 theme system. Maps the semantic theme
// model (window.ThemeConfiguration) onto the CSS variables defined in
// styles/tailwind.css, deriving hover/soft/faint shades so each color only
// needs one source value. Reused by app/bootstrap.ts (global, on <html>) and
// the admin Theme page's live preview (scoped, on a container element).

export type ThemeColorKey =
    | 'primary'
    | 'canvas'
    | 'surface'
    | 'surface_2'
    | 'border'
    | 'ink'
    | 'ink_muted'
    | 'accent'
    | 'warning'
    | 'danger';

export type RadiusKey = 'sharp' | 'soft' | 'round';

export type ThemeColors = Record<ThemeColorKey, string>;

export interface ThemeFeel {
    radius: RadiusKey;
    grid_enabled: boolean;
    grid_opacity: number; // 0..100 (grid line strength)
    grid_size: number; // px (grid cell size)
    aurora_enabled: boolean;
    aurora_intensity: number; // 0..100 (ambient glow strength)
}

export interface Theme {
    colors: ThemeColors;
    feel: ThemeFeel;
}

// The keys that make up a neutral "base palette" (everything but brand/status).
export type BaseColorKey = 'canvas' | 'surface' | 'surface_2' | 'border' | 'ink' | 'ink_muted';

export const DEFAULT_COLORS: ThemeColors = {
    primary: '#0047fc',
    // Graphite base: each neutral layer steps ~5-7 ΔL* from the last so panels
    // read as separate surfaces instead of dissolving into the canvas.
    canvas: '#0c0e13',
    surface: '#161a21',
    surface_2: '#222833',
    border: '#3a4453',
    ink: '#f2f4f8',
    ink_muted: '#9aa4b4',
    accent: '#18d39a',
    warning: '#f5a623',
    danger: '#f1545b',
};

export const DEFAULT_FEEL: ThemeFeel = {
    radius: 'soft',
    grid_enabled: true,
    grid_opacity: 60,
    grid_size: 28,
    aurora_enabled: true,
    aurora_intensity: 100,
};

export const DEFAULT_THEME: Theme = { colors: { ...DEFAULT_COLORS }, feel: { ...DEFAULT_FEEL } };

// --radius-card value per radius choice.
export const RADIUS_VALUES: Record<RadiusKey, string> = {
    sharp: '0.5rem',
    soft: '1rem',
    round: '1.5rem',
};

// ── UI metadata ─────────────────────────────────────────────────────────────
// Plain-language descriptions so the admin page can tell the operator exactly
// what each control changes (the "better understanding" goal).

export type TokenGroup = 'Brand' | 'Base' | 'Status';

export interface TokenMeta {
    key: ThemeColorKey;
    label: string;
    group: TokenGroup;
    description: string;
}

export const THEME_TOKENS: TokenMeta[] = [
    { key: 'primary', label: 'Brand', group: 'Brand', description: 'Buttons, links, focus rings and active accents. Hover shades are derived automatically.' },
    { key: 'canvas', label: 'Canvas', group: 'Base', description: 'The app background behind everything.' },
    { key: 'surface', label: 'Surface', group: 'Base', description: 'Panels, cards and the sidebar.' },
    { key: 'surface_2', label: 'Elevated', group: 'Base', description: 'Raised surfaces — inputs, hovered rows, inner cards.' },
    { key: 'border', label: 'Border', group: 'Base', description: 'Hairline borders and dividers (a softer tint is derived for subtle lines).' },
    { key: 'ink', label: 'Text', group: 'Base', description: 'Primary text and headings.' },
    { key: 'ink_muted', label: 'Muted text', group: 'Base', description: 'Secondary text, labels and captions (a fainter tint is derived).' },
    { key: 'accent', label: 'Accent', group: 'Status', description: 'Success / healthy / online states.' },
    { key: 'warning', label: 'Warning', group: 'Status', description: 'Installing, transferring and caution states.' },
    { key: 'danger', label: 'Danger', group: 'Status', description: 'Errors, suspended servers and destructive actions.' },
];

// Curated brand swatches for the quick picker (M12Labs Blue first / default).
export const BRAND_SWATCHES: { hex: string; name: string }[] = [
    { hex: '#0047fc', name: 'M12Labs Blue' },
    { hex: '#3b82f6', name: 'Sky' },
    { hex: '#6d5efc', name: 'Iris Purple' },
    { hex: '#16a34a', name: 'Jexactyl Green' },
    { hex: '#12aaaa', name: 'Microsoft Teal' },
    { hex: '#f59e0b', name: 'Amber' },
    { hex: '#ef4444', name: 'Brick Red' },
    { hex: '#ff99c8', name: 'Pretty Pink' },
    { hex: '#5e6472', name: 'Plain Grey' },
];

// Named neutral ramps. Picking one sets all six base keys at once.
export interface BasePalette {
    id: string;
    name: string;
    colors: Record<BaseColorKey, string>;
}

export const BASE_PALETTES: BasePalette[] = [
    // Deep-contrast ramps (default first). Each layer steps ~5-7 ΔL* so cards,
    // rows and inputs stay legible as distinct surfaces on dark grounds.
    { id: 'graphite', name: 'Graphite', colors: { canvas: '#0c0e13', surface: '#161a21', surface_2: '#222833', border: '#3a4453', ink: '#f2f4f8', ink_muted: '#9aa4b4' } },
    { id: 'deep-slate', name: 'Deep Slate', colors: { canvas: '#0a0f1a', surface: '#141c2c', surface_2: '#202c44', border: '#35466a', ink: '#eef3fc', ink_muted: '#93a2c0' } },
    { id: 'warm-carbon', name: 'Warm Carbon', colors: { canvas: '#100e0b', surface: '#1c1812', surface_2: '#2a2419', border: '#48402d', ink: '#f7f2ea', ink_muted: '#b3a68f' } },
    // Legacy low-contrast ramps — kept for continuity; these blend on dark grounds.
    { id: 'void', name: 'Void', colors: { canvas: '#0a0a0f', surface: '#121219', surface_2: '#1a1a24', border: '#2e2e3d', ink: '#f4f4f7', ink_muted: '#9a9aae' } },
    { id: 'pure-black', name: 'Pure Black', colors: { canvas: '#000000', surface: '#0a0a0a', surface_2: '#141414', border: '#262626', ink: '#fafafa', ink_muted: '#8a8a8a' } },
    { id: 'slate', name: 'Slate', colors: { canvas: '#0f1115', surface: '#181b21', surface_2: '#21252e', border: '#333a45', ink: '#f1f5f9', ink_muted: '#98a2b3' } },
    { id: 'midnight', name: 'Midnight', colors: { canvas: '#0b1020', surface: '#121a2e', surface_2: '#1b2540', border: '#2b3550', ink: '#eef2ff', ink_muted: '#94a3c8' } },
    { id: 'warm', name: 'Warm Forge', colors: { canvas: '#0f0d0a', surface: '#18140f', surface_2: '#221c14', border: '#3a3024', ink: '#faf6f0', ink_muted: '#b3a48f' } },
];

// ── Normalisation ───────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const asNum = (v: unknown, fallback: number): number => {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : fallback;
};

const asBool = (v: unknown, fallback: boolean): boolean => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true' || v === '1';
    if (typeof v === 'number') return v !== 0;
    return fallback;
};

// Coerce a loose window.ThemeConfiguration-shaped value into a complete Theme,
// filling any missing/empty fields from the defaults.
export function normalizeTheme(raw: unknown): Theme {
    const r = (raw ?? {}) as { colors?: Record<string, unknown>; feel?: Record<string, unknown> };
    const rc = r.colors ?? {};
    const rf = r.feel ?? {};

    const colors = { ...DEFAULT_COLORS } as ThemeColors;
    for (const key of Object.keys(DEFAULT_COLORS) as ThemeColorKey[]) {
        const v = rc[key];
        if (typeof v === 'string' && v.trim() !== '') colors[key] = v;
    }

    const radius = rf.radius;
    const feel: ThemeFeel = {
        radius: radius === 'sharp' || radius === 'round' ? radius : 'soft',
        grid_enabled: asBool(rf.grid_enabled, DEFAULT_FEEL.grid_enabled),
        grid_opacity: clamp(asNum(rf.grid_opacity, DEFAULT_FEEL.grid_opacity), 0, 100),
        grid_size: clamp(asNum(rf.grid_size, DEFAULT_FEEL.grid_size), 4, 200),
        aurora_enabled: asBool(rf.aurora_enabled, DEFAULT_FEEL.aurora_enabled),
        aurora_intensity: clamp(asNum(rf.aurora_intensity, DEFAULT_FEEL.aurora_intensity), 0, 100),
    };

    return { colors, feel };
}

// ── Application ─────────────────────────────────────────────────────────────

// Write the theme onto a target element's CSS custom properties + data attrs.
// Defaults to <html> for the global theme; pass a container for scoped preview.
export function applyThemeVars(theme: Theme, target: HTMLElement = document.documentElement): void {
    const s = target.style;
    const c = theme.colors;
    const set = (k: string, v: string) => s.setProperty(k, v);

    // Brand + derived hover/soft tints.
    const hover = `color-mix(in oklab, ${c.primary} 88%, #000)`;
    set('--color-brand', c.primary);
    set('--brand', c.primary);
    set('--brand-hover', hover);
    set('--color-brand-hover', hover);
    set('--brand-soft', `color-mix(in oklab, ${c.primary} 16%, transparent)`);

    // Surfaces.
    set('--color-canvas', c.canvas);
    set('--canvas', c.canvas);
    set('--color-surface', c.surface);
    set('--surface', c.surface);
    set('--sidebar', c.surface);
    set('--color-surface-2', c.surface_2);

    // Borders: strong = source, subtle = source at lower alpha. Kept high enough
    // (58%) that hairline dividers stay visible on near-black canvases.
    set('--color-border-strong', c.border);
    set('--color-border', `color-mix(in oklab, ${c.border} 58%, transparent)`);

    // Ink ramp: faint blends toward the canvas.
    set('--color-ink', c.ink);
    set('--headers', c.ink);
    set('--color-ink-muted', c.ink_muted);
    set('--color-ink-faint', `color-mix(in oklab, ${c.ink_muted} 62%, ${c.canvas})`);

    // Status.
    set('--color-accent', c.accent);
    set('--color-warning', c.warning);
    set('--color-danger', c.danger);

    // Feel / texture.
    const f = theme.feel;
    set('--radius-card', RADIUS_VALUES[f.radius] ?? RADIUS_VALUES.soft);
    set('--grid-opacity', String(f.grid_opacity));
    set('--grid-size', `${f.grid_size}px`);
    set('--aurora-intensity', String(f.aurora_intensity / 100));
    target.setAttribute('data-grid', f.grid_enabled ? 'on' : 'off');
    target.setAttribute('data-aurora', f.aurora_enabled ? 'on' : 'off');
}
