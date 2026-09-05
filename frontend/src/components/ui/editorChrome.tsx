import { m } from '@/i18n/messages';
import { Save, RotateCcw, AlertTriangle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';

// Shared chrome for the panel's full-page editors — billing products and
// categories, the egg editor, and the infrastructure server/node editors.
// Titled section cards, a label/field row, and a sticky save bar that reflects
// unsaved state. Lives in components/ui because it is no longer billing-only.

export function SectionCard({
    id,
    icon: Icon,
    title,
    desc,
    right,
    children,
}: {
    id?: string;
    icon: LucideIcon;
    title: string;
    desc: string;
    right?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <header className="flex flex-col items-stretch gap-3 border-b border-[var(--color-border)] px-5 py-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                        <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
                        <p className="text-xs text-[var(--color-ink-faint)]">{desc}</p>
                    </div>
                </div>
                {right && <div className="flex shrink-0 items-center sm:ml-auto">{right}</div>}
            </header>
            <div className="flex flex-col gap-5 p-5">{children}</div>
        </section>
    );
}

// Lays fields out side by side instead of one full-width row each. Dense admin
// forms are mostly short inputs (ports, limits, counts) — stacking them turns a
// four-field section into four screens of scrolling. Pair them up by default and
// let the genuinely long ones opt out with <FieldRow wide>.
export function FieldGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }) {
    return (
        <div className={cn('grid gap-x-5 gap-y-4', columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}>
            {children}
        </div>
    );
}

export function FieldRow({
    label,
    desc,
    mono,
    error,
    wide,
    children,
}: {
    label: string;
    desc?: string;
    mono?: string;
    error?: string;
    /** Span the whole FieldGrid — for paths, commands, descriptions, textareas. */
    wide?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className={cn('flex flex-col gap-1.5', wide && 'sm:col-span-full')}>
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

// A group of related on/off settings, rendered as a single bordered list with
// each option labelled + described. Reads far cleaner than scattered switches.
export function ToggleGroup({ children }: { children: React.ReactNode }) {
    return (
        <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40">
            {children}
        </div>
    );
}

export function ToggleRow({
    label,
    desc,
    checked,
    onChange,
    disabled,
}: {
    label: string;
    desc?: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)]">{label}</p>
                {desc && <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{desc}</p>}
            </div>
            <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
        </div>
    );
}

export function SaveBar({
    dirty,
    saving,
    onDiscard,
    blockedReason,
}: {
    dirty: boolean;
    saving: boolean;
    onDiscard: () => void;
    /**
     * Why the form can't be submitted yet, if it can't. Passing this disables
     * Save and shows the reason — an enabled button whose handler silently
     * bails reads as "saving is broken", which is exactly how the new-category
     * form failed before anyone had picked a nest.
     */
    blockedReason?: string | null;
}) {
    const blocked = Boolean(blockedReason);

    return (
        <div className="sticky bottom-4 z-10 flex flex-col items-stretch gap-2 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-3 shadow-2xl shadow-black/30 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
            {blocked ? (
                <span className="flex items-center gap-2 text-xs text-[var(--color-warning)]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {blockedReason}
                </span>
            ) : (
                <span className={cn('flex items-center gap-2 text-xs', dirty ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', dirty ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-ink-faint)]')} />
                    {dirty ? m['common.editor.unsaved']() : m['common.editor.allSaved']()}
                </span>
            )}
            <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={!dirty || saving}>
                    <RotateCcw className="h-4 w-4" /> {m['common.actions.discard']()}
                </Button>
                <Button type="submit" size="sm" disabled={!dirty || saving || blocked}>
                    {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {m['common.actions.save']()}
                </Button>
            </div>
        </div>
    );
}
