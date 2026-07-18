import { m } from '@/i18n';
import { Download, ArrowUpCircle, Power, PowerOff, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Counts {
    install: number;
    uninstall: number;
    update: number;
    enable: number;
    disable: number;
}

// Floating action bar for the multi-select flow. It only renders once something
// is selected, and each action button appears only when at least one selected
// extension is eligible for it — so the bar never offers a no-op.
export function BatchActionBar({
    count,
    busy,
    counts,
    onClear,
    onInstall,
    onUninstall,
    onUpdate,
    onEnable,
    onDisable,
}: {
    count: number;
    busy: boolean;
    counts: Counts;
    onClear: () => void;
    onInstall: () => void;
    onUninstall: () => void;
    onUpdate: () => void;
    onEnable: () => void;
    onDisable: () => void;
}) {
    if (count === 0) return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
            <div
                style={{ borderRadius: 'var(--radius-card)' }}
                className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 shadow-2xl shadow-black/30 backdrop-blur"
            >
                <span className="px-1 text-xs font-semibold tabular-nums text-[var(--color-ink)]">
                    {m['extensions.select.count']({ count })}
                </span>

                <span className="h-5 w-px bg-[var(--color-border)]" aria-hidden />

                {counts.install > 0 && (
                    <BatchButton icon={Download} label={m['extensions.select.install']()} n={counts.install} disabled={busy} onClick={onInstall} variant="brand" />
                )}
                {counts.update > 0 && (
                    <BatchButton icon={ArrowUpCircle} label={m['extensions.select.update']()} n={counts.update} disabled={busy} onClick={onUpdate} />
                )}
                {counts.enable > 0 && (
                    <BatchButton icon={Power} label={m['extensions.select.enable']()} n={counts.enable} disabled={busy} onClick={onEnable} />
                )}
                {counts.disable > 0 && (
                    <BatchButton icon={PowerOff} label={m['extensions.select.disable']()} n={counts.disable} disabled={busy} onClick={onDisable} />
                )}
                {counts.uninstall > 0 && (
                    <BatchButton icon={Trash2} label={m['extensions.select.uninstall']()} n={counts.uninstall} disabled={busy} onClick={onUninstall} variant="danger" />
                )}

                <span className="h-5 w-px bg-[var(--color-border)]" aria-hidden />

                <button
                    type="button"
                    onClick={onClear}
                    aria-label={m['extensions.select.clear']()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                >
                    <X className="h-3.5 w-3.5" />
                    {m['extensions.select.clear']()}
                </button>
            </div>
        </div>
    );
}

function BatchButton({
    icon: Icon,
    label,
    n,
    disabled,
    onClick,
    variant = 'default',
}: {
    icon: typeof Download;
    label: string;
    n: number;
    disabled: boolean;
    onClick: () => void;
    variant?: 'default' | 'brand' | 'danger';
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:opacity-50',
                variant === 'brand' && 'bg-[var(--brand)] text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]',
                variant === 'danger' &&
                    'border border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
                variant === 'default' &&
                    'border border-[var(--color-border-strong)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]',
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="tabular-nums opacity-70">{n}</span>
        </button>
    );
}
