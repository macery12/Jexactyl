import { m, td } from '@/i18n';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { getStatusPresentation, toneChip, type EmailTone } from './status';

// Section card: a titled, described container for a slice of settings. Mirrors
// the ops-grade surfaces used elsewhere in the admin (border + soft surface).
export function SettingsCard({
    title,
    description,
    right,
    children,
    className,
}: {
    title: string;
    description?: string;
    right?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                'rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-5',
                className,
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
                    {description && (
                        <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{description}</p>
                    )}
                </div>
                {right && <div className="shrink-0">{right}</div>}
            </div>
            <div className="mt-4">{children}</div>
        </section>
    );
}

// Status chip rendered from an email status string. Icon + translated label,
// toned via the theme tokens.
export function StatusChip({ status, className }: { status?: string | null; className?: string }) {
    const { labelKey, tone, icon: Icon } = getStatusPresentation(status);
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                toneChip[tone],
                className,
            )}
        >
            <Icon className="h-3 w-3" />
            {td(`admin.${labelKey}`)}
        </span>
    );
}

// Generic tone pill for free-form labels (Active / Configured / …).
export function TonePill({ tone, children }: { tone: EmailTone; children: ReactNode }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                toneChip[tone],
            )}
        >
            {children}
        </span>
    );
}

// Sticky save bar shared by the settings pages. Shows dirty/clean state and a
// save + discard pair.
export function SaveBar({
    dirty,
    saving,
    onDiscard,
    onSave,
}: {
    dirty: boolean;
    saving: boolean;
    onDiscard: () => void;
    onSave: () => void;
}) {
    return (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-5 py-3 shadow-2xl shadow-black/30 backdrop-blur">
            <span
                className={cn(
                    'flex items-center gap-2 text-xs',
                    dirty ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]',
                )}
            >
                <span
                    className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        dirty ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-ink-faint)]',
                    )}
                />
                {dirty ? m['admin.email.saveBar.dirty']() : m['admin.email.saveBar.clean']()}
            </span>
            <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={!dirty || saving}>
                    {m['common.actions.discard']()}
                </Button>
                <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving}>
                    {m['common.actions.save']()}
                </Button>
            </div>
        </div>
    );
}

// Labeled field wrapper used by the settings forms.
export function LabeledField({
    label,
    hint,
    required,
    children,
}: {
    label: string;
    hint?: string;
    required?: boolean;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-ink-muted)]">
                {label}
                {required && <span className="ml-0.5 text-[var(--color-danger)]">*</span>}
            </label>
            {children}
            {hint && <span className="text-xs text-[var(--color-ink-faint)]">{hint}</span>}
        </div>
    );
}
