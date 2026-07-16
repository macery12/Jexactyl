import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

// Shared ops-grade panel chrome: hairline border, tight radius, an uppercase
// micro-label header with an optional right slot. `flush` removes body padding
// (used by the console so the terminal owns its box). Used across the server
// cockpit and the admin node cockpit so the whole app reads consistently.
export function Panel({
    title,
    icon: Icon,
    right,
    children,
    className,
    bodyClassName,
    flush,
}: {
    title: string;
    icon?: LucideIcon;
    right?: ReactNode;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
    flush?: boolean;
}) {
    return (
        <section
            className={cn(
                'flex min-h-0 flex-col rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70',
                className,
            )}
        >
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
                {Icon && <Icon className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />}
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {title}
                </span>
                {right && <div className="ml-auto flex items-center">{right}</div>}
            </header>
            <div className={cn('min-h-0 flex-1', flush ? '' : 'p-3', bodyClassName)}>{children}</div>
        </section>
    );
}
