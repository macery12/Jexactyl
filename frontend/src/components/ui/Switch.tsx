import { cn } from '@/lib/cn';

// Theme-driven toggle switch. `on` track uses the accent token; off uses an
// elevated surface. Sizes match the ops-grade chrome (compact by default).
export function Switch({
    checked,
    onChange,
    disabled,
    label,
    className,
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    label?: string;
    className?: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60 disabled:opacity-50',
                checked
                    ? 'border-transparent bg-[var(--brand)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]',
                className,
            )}
        >
            <span
                className={cn(
                    'inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--color-brand-ink)] shadow-sm transition-transform duration-150',
                    checked ? 'translate-x-4' : 'translate-x-1',
                )}
            />
        </button>
    );
}
