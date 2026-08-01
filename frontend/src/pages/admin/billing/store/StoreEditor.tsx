import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Plus, Trash2, ExternalLink, EyeOff, X } from 'lucide-react';
import { m, td } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useFlags } from '@/state/flags';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { getStoreConfig, updateStoreConfig } from '@/api/adminStore';
import { getStoreCategories, getCategoryProducts } from '@/api/accountBilling';
import type { StoreConfiguration, StoreSection, StoreSectionId, StoreSectionData, StoreFeatureItem } from '@/lib/globals';
import { LANDING_ICON_NAMES, resolveIcon } from '@/pages/landing/sections/icons';
import { useWideContent } from '@/components/shell/shellLayout';
import StoreCanvas from '@/pages/account/billing/store/StoreCanvas';

const SECTION_META: Record<StoreSectionId, { titleKey: string; descKey: string }> = {
    hero: { titleKey: 'storeAdmin.hero.title', descKey: 'storeAdmin.hero.desc' },
    features: { titleKey: 'storeAdmin.features.title', descKey: 'storeAdmin.features.desc' },
    catalog: { titleKey: 'storeAdmin.catalog.title', descKey: 'storeAdmin.catalog.desc' },
    custom: { titleKey: 'storeAdmin.custom.title', descKey: 'storeAdmin.custom.desc' },
    trust: { titleKey: 'storeAdmin.trust.title', descKey: 'storeAdmin.trust.desc' },
};

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            {...props}
            className={cn(
                'min-h-[88px] w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-ink)]',
                'placeholder:text-[var(--color-ink-faint)] transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)] focus:border-[var(--color-focus)]',
                props.className,
            )}
        />
    );
}

export default function StoreEditor() {
    const push = useFlashes(s => s.push);
    const injected = window.EverestConfiguration?.billing?.store ?? null;
    const [config, setConfig] = useState<StoreConfiguration | null>(injected);
    const [saved, setSaved] = useState<StoreConfiguration | null>(injected);
    const [saving, setSaving] = useState(false);
    const [selectedId, setSelectedId] = useState<StoreSectionId>('hero');

    // Three-column layout — let it use the full width instead of the default
    // centered container that would squish the columns.
    useWideContent();

    // Fetch from the API if nothing was injected (defensive — the composer
    // normally injects it on every page load).
    useEffect(() => {
        if (config) return;
        getStoreConfig()
            .then(c => {
                setConfig(c);
                setSaved(c);
            })
            .catch(err => push({ type: 'error', message: firstError(err) ?? m['storeAdmin.loadError']() }));
    }, [config, push]);

    const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);

    if (!config) {
        return (
            <div className="flex items-center justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const sections = config.sections;
    const selectedIndex = Math.max(0, sections.findIndex(s => s.id === selectedId));
    const selected = sections[selectedIndex];

    const updateSection = (index: number, patch: Partial<StoreSection>) =>
        setConfig(c => (c ? { ...c, sections: c.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : c));

    const updateData = (index: number, data: Record<string, unknown>) => {
        const current = sections[index];
        if (!current) return;
        updateSection(index, { data: { ...current.data, ...data } });
    };

    const move = (index: number, dir: -1 | 1) => {
        const target = index + dir;
        if (target < 0 || target >= sections.length) return;
        setConfig(c => {
            if (!c) return c;
            const next = c.sections.slice();
            const a = next[index];
            const b = next[target];
            if (!a || !b) return c;
            next[index] = b;
            next[target] = a;
            return { ...c, sections: next.map((s, i) => ({ ...s, order: i })) };
        });
    };

    const handleSave = async () => {
        if (saving || !config) return;
        setSaving(true);
        const normalized: StoreConfiguration = {
            enabled: config.enabled,
            sections: config.sections.map((s, i) => ({ ...s, order: i })),
        };
        try {
            await updateStoreConfig(normalized);
            // Live-patch the injected everest billing config so the store page (in
            // this tab) reflects the saved config without a reload.
            useFlags.setState(s =>
                s.everest ? { everest: { ...s.everest, billing: { ...s.everest.billing, store: normalized } } } : {},
            );
            if (window.EverestConfiguration?.billing) window.EverestConfiguration.billing.store = normalized;
            setSaved(normalized);
            setConfig(normalized);
            push({ type: 'success', message: m['storeAdmin.saved']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['storeAdmin.saveError']() });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{m['storeAdmin.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['storeAdmin.subtitle']()}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        to="/billing/order"
                        target="_blank"
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]"
                    >
                        <ExternalLink className="h-4 w-4" />
                        {m['storeAdmin.preview']()}
                    </Link>
                    <Button disabled={!dirty || saving} onClick={handleSave}>
                        {saving ? <Spinner className="h-4 w-4" /> : m['common.actions.saveChanges']()}
                    </Button>
                </div>
            </header>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-[var(--color-ink)]">{m['storeAdmin.enabled']()}</span>
                    <span className="mt-0.5 block text-sm text-[var(--color-ink-muted)]">{m['storeAdmin.enabledHelp']()}</span>
                </span>
                <Switch checked={config.enabled} onChange={v => setConfig(c => (c ? { ...c, enabled: v } : c))} className="mt-1" />
            </label>

            <div
                className={cn(
                    'grid grid-cols-1 gap-6 xl:grid-cols-[210px_minmax(0,1fr)_minmax(0,440px)]',
                    !config.enabled && 'pointer-events-none opacity-50',
                )}
            >
                {/* Left rail: section list — select, toggle, reorder. */}
                <div>
                    <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {m['storeAdmin.sectionsLabel']()}
                    </h2>
                    <ul className="flex flex-col gap-1">
                        {sections.map((section, index) => (
                            <SectionListRow
                                key={section.id}
                                section={section}
                                selected={section.id === selectedId}
                                isFirst={index === 0}
                                isLast={index === sections.length - 1}
                                onSelect={() => setSelectedId(section.id)}
                                onToggle={v => updateSection(index, { enabled: v })}
                                onMove={dir => move(index, dir)}
                            />
                        ))}
                    </ul>
                </div>

                {/* Center: editor for the selected section. */}
                {selected && (
                    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                        <div className="mb-5 flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
                            <div className="min-w-0">
                                <h2 className="text-base font-semibold text-[var(--color-ink)]">{td(SECTION_META[selected.id].titleKey)}</h2>
                                <p className="text-sm text-[var(--color-ink-muted)]">{td(SECTION_META[selected.id].descKey)}</p>
                            </div>
                            <Switch checked={selected.enabled} onChange={v => updateSection(selectedIndex, { enabled: v })} className="mt-0.5" />
                        </div>
                        {!selected.enabled && (
                            <p className="mb-4 flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                                <EyeOff className="h-3.5 w-3.5 shrink-0" />
                                {m['storeAdmin.hiddenNotice']()}
                            </p>
                        )}
                        <SectionFields section={selected} onData={data => updateData(selectedIndex, data)} />
                    </div>
                )}

                {/* Right: live, scaled preview of the store page. */}
                <div className="xl:sticky xl:top-6 xl:self-start">
                    <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {m['storeAdmin.previewLabel']()}
                    </h2>
                    <p className="mb-2 px-1 text-xs text-[var(--color-ink-faint)]">{m['storeAdmin.previewHint']()}</p>
                    <div className="max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--color-border-strong)] p-4">
                        <PreviewFrame>
                            <StoreCanvas sections={config.sections} highlightId={selectedId} />
                        </PreviewFrame>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Renders the children at a fixed design width, scaled down to fit the preview
// column so the editor shows a faithful miniature of the store page.
const DESIGN_WIDTH = 1024;
function PreviewFrame({ children }: { children: React.ReactNode }) {
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.3);
    const [height, setHeight] = useState(0);

    useLayoutEffect(() => {
        const o = outer.current;
        const i = inner.current;
        if (!o || !i) return;
        const update = () => {
            const s = o.clientWidth / DESIGN_WIDTH;
            setScale(s);
            setHeight(i.offsetHeight * s);
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(o);
        ro.observe(i);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={outer} className="w-full overflow-hidden" style={{ height }}>
            {/* Static, non-interactive: clicks/links shouldn't navigate away from the editor. */}
            <div
                ref={inner}
                aria-hidden
                className="pointer-events-none select-none"
                style={{ width: DESIGN_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            >
                {children}
            </div>
        </div>
    );
}

function SectionListRow({
    section,
    selected,
    isFirst,
    isLast,
    onSelect,
    onToggle,
    onMove,
}: {
    section: StoreSection;
    selected: boolean;
    isFirst: boolean;
    isLast: boolean;
    onSelect: () => void;
    onToggle: (v: boolean) => void;
    onMove: (dir: -1 | 1) => void;
}) {
    const meta = SECTION_META[section.id];
    return (
        <li
            className={cn(
                'flex items-center gap-1 rounded-lg border px-2 py-1.5',
                selected ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-transparent hover:bg-[var(--color-surface-2)]',
            )}
        >
            <div className="flex flex-col">
                <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => onMove(-1)}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-30"
                    aria-label={m['storeAdmin.moveUp']()}
                >
                    <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    disabled={isLast}
                    onClick={() => onMove(1)}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-30"
                    aria-label={m['storeAdmin.moveDown']()}
                >
                    <ChevronDown className="h-3.5 w-3.5" />
                </button>
            </div>
            <button type="button" onClick={onSelect} className="min-w-0 flex-1 py-1 text-left">
                <span className={cn('block truncate text-sm font-medium', section.enabled ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]')}>
                    {td(meta.titleKey)}
                </span>
                {!section.enabled && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {m['storeAdmin.hiddenBadge']()}
                    </span>
                )}
            </button>
            <Switch checked={section.enabled} onChange={onToggle} />
        </li>
    );
}

function SectionFields({ section, onData }: { section: StoreSection; onData: (data: Record<string, unknown>) => void }) {
    const d = section.data;

    switch (section.id) {
        case 'hero':
            return (
                <div className="grid gap-5">
                    <Field label={m['storeAdmin.field.badge']()} hint={m['storeAdmin.field.fallbackHint']()}>
                        <Input value={d.badge ?? ''} maxLength={120} onChange={e => onData({ badge: e.target.value })} />
                    </Field>
                    <Field label={m['storeAdmin.field.heading']()} hint={m['storeAdmin.field.fallbackHint']()}>
                        <Input value={d.title ?? ''} maxLength={200} onChange={e => onData({ title: e.target.value })} />
                    </Field>
                    <Field label={m['storeAdmin.field.subtitle']()} hint={m['storeAdmin.field.fallbackHint']()}>
                        <Textarea value={d.subtitle ?? ''} maxLength={600} onChange={e => onData({ subtitle: e.target.value })} />
                    </Field>
                    <Field label={m['storeAdmin.field.backgroundImage']()} hint={m['storeAdmin.field.backgroundImageHelp']()}>
                        <Input type="url" value={d.backgroundImage ?? ''} maxLength={500} onChange={e => onData({ backgroundImage: e.target.value })} />
                    </Field>
                    <Field label={m['storeAdmin.field.promoText']()} hint={m['storeAdmin.field.promoTextHelp']()}>
                        <Input value={d.promoText ?? ''} maxLength={300} onChange={e => onData({ promoText: e.target.value })} />
                    </Field>
                    <CtaEditor
                        label={m['storeAdmin.field.primaryCta']()}
                        hint={m['storeAdmin.field.primaryCtaHelp']()}
                        cta={d.primaryCta ?? { label: '', href: '' }}
                        hrefPlaceholder="#plans"
                        onChange={cta => onData({ primaryCta: cta })}
                    />
                </div>
            );

        case 'features': {
            const items = (d.items ?? []) as StoreFeatureItem[];
            return (
                <div className="grid gap-5">
                    <Field label={m['storeAdmin.field.heading']()} hint={m['storeAdmin.field.fallbackHint']()}>
                        <Input value={d.heading ?? ''} maxLength={200} onChange={e => onData({ heading: e.target.value })} />
                    </Field>
                    <ItemList
                        items={items}
                        onChange={next => onData({ items: next })}
                        blank={{ icon: 'Zap', title: '', body: '' }}
                        addLabel={m['storeAdmin.addFeature']()}
                        render={(item, update) => (
                            <div className="grid gap-3">
                                <Field label={m['storeAdmin.field.icon']()}>
                                    <IconPicker value={item.icon} onChange={icon => update({ icon })} />
                                </Field>
                                <Field label={m['storeAdmin.field.itemTitle']()}>
                                    <Input value={item.title} maxLength={160} onChange={e => update({ title: e.target.value })} />
                                </Field>
                                <Field label={m['storeAdmin.field.body']()}>
                                    <Textarea value={item.body} maxLength={800} onChange={e => update({ body: e.target.value })} />
                                </Field>
                            </div>
                        )}
                    />
                </div>
            );
        }

        case 'catalog':
            return <CatalogFields data={d} onData={onData} />;

        case 'custom':
            return (
                <div className="grid gap-5">
                    <Field label={m['storeAdmin.field.heading']()} hint={m['storeAdmin.field.customHeadingHelp']()}>
                        <Input value={d.title ?? ''} maxLength={200} onChange={e => onData({ title: e.target.value })} />
                    </Field>
                    <Field label={m['storeAdmin.field.body']()} hint={m['storeAdmin.field.customBodyHelp']()}>
                        <Textarea value={d.body ?? ''} maxLength={5000} className="min-h-[160px]" onChange={e => onData({ body: e.target.value })} />
                    </Field>
                </div>
            );

        case 'trust': {
            const items = (d.items ?? []) as StoreFeatureItem[];
            return (
                <div className="grid gap-5">
                    <Field label={m['storeAdmin.field.acceptedLabel']()} hint={m['storeAdmin.field.fallbackHint']()}>
                        <Input value={d.acceptedLabel ?? ''} maxLength={120} onChange={e => onData({ acceptedLabel: e.target.value })} />
                    </Field>
                    <Field label={m['storeAdmin.field.methods']()} hint={m['storeAdmin.field.methodsHelp']()}>
                        <ChipList values={d.methods ?? []} onChange={methods => onData({ methods })} placeholder={m['storeAdmin.field.methodsPlaceholder']()} />
                    </Field>
                    <ItemList
                        items={items}
                        onChange={next => onData({ items: next })}
                        blank={{ icon: 'ShieldCheck', title: '', body: '' }}
                        addLabel={m['storeAdmin.addTile']()}
                        render={(item, update) => (
                            <div className="grid gap-3">
                                <Field label={m['storeAdmin.field.icon']()}>
                                    <IconPicker value={item.icon} onChange={icon => update({ icon })} />
                                </Field>
                                <Field label={m['storeAdmin.field.itemTitle']()}>
                                    <Input value={item.title} maxLength={160} onChange={e => update({ title: e.target.value })} />
                                </Field>
                                <Field label={m['storeAdmin.field.body']()}>
                                    <Textarea value={item.body} maxLength={800} onChange={e => update({ body: e.target.value })} />
                                </Field>
                            </div>
                        )}
                    />
                </div>
            );
        }

        default:
            return null;
    }
}

// Catalog fields, incl. the spotlight ("most popular") plan controls. Split into
// its own component so the product-picker queries obey the rules of hooks (the
// parent SectionFields renders a different branch per section id).
function CatalogFields({ data, onData }: { data: StoreSectionData; onData: (data: Record<string, unknown>) => void }) {
    const catQ = useQuery({ queryKey: ['store', 'categories'], queryFn: getStoreCategories });
    const cats = catQ.data ?? [];
    const prodQ = useQuery({
        queryKey: ['store', 'all-products', cats.map(c => c.id).join(',')],
        queryFn: () => Promise.all(cats.map(c => getCategoryProducts(c.id).then(products => ({ cat: c, products })))),
        enabled: cats.length > 0,
    });
    const groups = prodQ.data ?? [];

    const productOptions: SelectOption[] = [
        { value: 'auto', label: m['storeAdmin.field.featuredAuto']() },
        ...groups.flatMap(g => g.products.map(p => ({ value: String(p.id), label: `${g.cat.name} — ${p.name}` }))),
    ];

    const showFeatured = data.featuredEnabled !== false;

    return (
        <div className="grid gap-5">
            <Field label={m['storeAdmin.field.heading']()} hint={m['storeAdmin.field.fallbackHint']()}>
                <Input value={data.heading ?? ''} maxLength={200} onChange={e => onData({ heading: e.target.value })} />
            </Field>
            <Field label={m['storeAdmin.field.subtitle']()} hint={m['storeAdmin.field.fallbackHint']()}>
                <Input value={data.subheading ?? ''} maxLength={600} onChange={e => onData({ subheading: e.target.value })} />
            </Field>

            <fieldset className="rounded-lg border border-[var(--color-border)] p-4">
                <legend className="px-1 text-sm font-medium text-[var(--color-ink-muted)]">{m['storeAdmin.field.featuredLegend']()}</legend>
                <label className="flex cursor-pointer items-start gap-3">
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--color-ink)]">{m['storeAdmin.field.featuredEnabled']()}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{m['storeAdmin.field.featuredEnabledHelp']()}</span>
                    </span>
                    <Switch checked={showFeatured} onChange={v => onData({ featuredEnabled: v })} className="mt-0.5" />
                </label>
                {showFeatured && (
                    <div className="mt-4 grid gap-4 border-t border-[var(--color-border)] pt-4">
                        <Field label={m['storeAdmin.field.featuredProduct']()} hint={m['storeAdmin.field.featuredProductHelp']()}>
                            <Select
                                value={data.featuredProductId != null ? String(data.featuredProductId) : 'auto'}
                                options={productOptions}
                                onChange={v => onData({ featuredProductId: v === 'auto' ? null : Number(v) })}
                            />
                        </Field>
                        <Field label={m['storeAdmin.field.featuredBadge']()} hint={m['storeAdmin.field.fallbackHint']()}>
                            <Input value={data.featuredBadge ?? ''} maxLength={60} onChange={e => onData({ featuredBadge: e.target.value })} />
                        </Field>
                        <Field label={m['storeAdmin.field.featuredCta']()} hint={m['storeAdmin.field.fallbackHint']()}>
                            <Input value={data.featuredCta ?? ''} maxLength={60} onChange={e => onData({ featuredCta: e.target.value })} />
                        </Field>
                    </div>
                )}
            </fieldset>

            <p className="text-xs text-[var(--color-ink-faint)]">{m['storeAdmin.catalog.note']()}</p>
        </div>
    );
}

// Compact visual icon grid — limited to the shared Lucide allowlist so stored
// config never references an arbitrary component.
function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {LANDING_ICON_NAMES.map(n => {
                const Icon = resolveIcon(n);
                const active = n === value;
                return (
                    <button
                        key={n}
                        type="button"
                        title={n}
                        aria-label={n}
                        aria-pressed={active}
                        onClick={() => onChange(n)}
                        className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                            active
                                ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                                : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                        )}
                    >
                        <Icon className="h-4 w-4" />
                    </button>
                );
            })}
        </div>
    );
}

function CtaEditor({
    label,
    hint,
    cta,
    hrefPlaceholder,
    onChange,
}: {
    label: string;
    hint?: string;
    cta: { label: string; href: string };
    hrefPlaceholder?: string;
    onChange: (cta: { label: string; href: string }) => void;
}) {
    return (
        <fieldset className="rounded-lg border border-[var(--color-border)] p-4">
            <legend className="px-1 text-sm font-medium text-[var(--color-ink-muted)]">{label}</legend>
            {hint && <p className="mb-2 text-xs text-[var(--color-ink-faint)]">{hint}</p>}
            <div className="grid gap-3">
                <Input placeholder={m['storeAdmin.field.ctaLabel']()} value={cta.label} maxLength={60} onChange={e => onChange({ ...cta, label: e.target.value })} />
                <Input placeholder={hrefPlaceholder ?? m['storeAdmin.field.ctaHref']()} value={cta.href} maxLength={300} onChange={e => onChange({ ...cta, href: e.target.value })} />
            </div>
        </fieldset>
    );
}

// Free-form string chips (accepted payment methods). Add on Enter, remove via ×.
function ChipList({ values, onChange, placeholder }: { values: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
    const [draft, setDraft] = useState('');
    const add = () => {
        const v = draft.trim();
        if (!v || values.includes(v) || values.length >= 12) return;
        onChange([...values, v]);
        setDraft('');
    };
    return (
        <div className="flex flex-col gap-2">
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {values.map(v => (
                        <span key={v} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-ink)]">
                            {v}
                            <button type="button" onClick={() => onChange(values.filter(x => x !== v))} aria-label={m['storeAdmin.removeItem']()} className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="flex gap-2">
                <Input
                    value={draft}
                    maxLength={40}
                    placeholder={placeholder}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            add();
                        }
                    }}
                />
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={add}>
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

// Generic add/remove/edit list for the repeated-item sections.
function ItemList<T extends object>({
    items,
    onChange,
    blank,
    addLabel,
    render,
}: {
    items: T[];
    onChange: (next: T[]) => void;
    blank: T;
    addLabel: string;
    render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4">
            {items.map((item, i) => (
                <div key={i} className="rounded-lg border border-[var(--color-border)] p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">#{i + 1}</span>
                        <button
                            type="button"
                            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                            className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                            aria-label={m['storeAdmin.removeItem']()}
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                    {render(item, patch => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))))}
                </div>
            ))}
            <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...items, { ...blank }])}>
                <Plus className="h-4 w-4" />
                {addLabel}
            </Button>
        </div>
    );
}
