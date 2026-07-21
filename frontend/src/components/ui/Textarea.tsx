import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
}

// Multi-line sibling of Input.tsx — same surface/border/focus chrome so forms
// and the ticket reply composers read consistently.
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, invalid, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(
                'w-full rounded-lg border bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]',
                'transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)] resize-y',
                invalid
                    ? 'border-[var(--color-danger)]'
                    : 'border-[var(--color-border-strong)] focus:border-[var(--color-focus)]',
                className,
            )}
            {...props}
        />
    ),
);
Textarea.displayName = 'Textarea';
