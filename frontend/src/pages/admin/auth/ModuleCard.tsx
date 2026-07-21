import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Per-card autosave helper. Each field runs its own mutation and the card head
// reflects the latest outcome (mirrors V1's AdminBox `status` prop). Errors also
// surface as a toast so the reason isn't lost when the badge fades.
export function useModuleSave() {
    const push = useFlashes(s => s.push);
    const [status, setStatus] = useState<SaveStatus>('idle');
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const run = useCallback(
        async (fn: () => Promise<unknown>) => {
            if (timer.current) clearTimeout(timer.current);
            setStatus('saving');
            try {
                await fn();
                setStatus('saved');
                timer.current = setTimeout(() => setStatus('idle'), 2000);
            } catch (err) {
                setStatus('error');
                push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            }
        },
        [push],
    );

    return { status, run };
}

function StatusBadge({ status }: { status: SaveStatus }) {
    if (status === 'saving') {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {m['common.states.saving']()}
            </span>
        );
    }
    if (status === 'saved') {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-accent)]">
                <Check className="h-3.5 w-3.5" />
                {m['admin.auth.saved']()}
            </span>
        );
    }
    if (status === 'error') {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
                <TriangleAlert className="h-3.5 w-3.5" />
                {m['admin.auth.saveError']()}
            </span>
        );
    }
    return null;
}

export function ModuleCard({
    icon: Icon,
    title,
    subtitle,
    status = 'idle',
    onRemove,
    removeLabel,
    children,
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    status?: SaveStatus;
    onRemove?: () => void;
    removeLabel?: string;
    children: ReactNode;
}) {
    return (
        <section className="flex flex-col rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold text-[var(--color-ink)]">{title}</h2>
                    {subtitle && <p className="text-sm text-[var(--color-ink-muted)]">{subtitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={status} />
                    {onRemove && (
                        <button
                            type="button"
                            onClick={onRemove}
                            aria-label={removeLabel}
                            title={removeLabel}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-danger)]/12 hover:text-[var(--color-danger)]"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-5">{children}</div>
        </section>
    );
}
