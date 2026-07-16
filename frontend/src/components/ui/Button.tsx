import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const button = cva(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 select-none',
    {
        variants: {
            variant: {
                primary: 'bg-[var(--brand)] text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)] shadow-lg shadow-[var(--brand)]/20',
                secondary: 'bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-border-strong)]',
                ghost: 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]',
                outline: 'border border-[var(--color-border-strong)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]',
                danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
            },
            size: {
                sm: 'h-9 px-3 text-sm',
                md: 'h-11 px-5 text-sm',
                lg: 'h-12 px-7 text-base',
                icon: 'h-10 w-10',
            },
        },
        defaultVariants: { variant: 'primary', size: 'md' },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, ...props }, ref) => (
        <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
    ),
);
Button.displayName = 'Button';
