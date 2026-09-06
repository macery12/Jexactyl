import { cloneElement, forwardRef, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, invalid, ...props }, ref) => (
        <input
            ref={ref}
            aria-invalid={invalid || undefined}
            className={cn(
                'h-11 w-full rounded-lg border bg-[var(--color-surface-2)] px-4 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]',
                // Focus lifts the field's own border a step instead of painting a
                // brand halo around it — see --color-focus in tailwind.css.
                'transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]',
                invalid
                    ? 'border-[var(--color-danger)]'
                    : 'border-[var(--color-border-strong)] focus:border-[var(--color-focus)]',
                className,
            )}
            {...props}
        />
    ),
);
Input.displayName = 'Input';

export function Field({
    label,
    hint,
    error,
    children,
    htmlFor,
}: {
    label: string;
    hint?: string;
    error?: string;
    htmlFor?: string;
    children: ReactNode;
}) {
    const generatedId = useId();
    const hintId = hint ? `${generatedId}-hint` : undefined;
    const errorId = error ? `${generatedId}-error` : undefined;
    const child = isValidElement(children)
        ? (children as ReactElement<{ 'aria-describedby'?: string }>)
        : null;
    const describedBy = [child?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--color-ink-muted)]">
                {label}
            </label>
            {hint && (
                <p id={hintId} className="-mt-0.5 text-xs text-[var(--color-ink-faint)]">
                    {hint}
                </p>
            )}
            {child ? cloneElement(child, { 'aria-describedby': describedBy }) : children}
            {error && (
                <span id={errorId} aria-live="polite" className="text-xs text-[var(--color-danger)]">
                    {error}
                </span>
            )}
        </div>
    );
}
