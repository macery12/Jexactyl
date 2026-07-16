import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// Soft settings card used by every section on the Account page. Header carries a
// title, optional icon + right-aligned slot (badge / action), and a description.
export function SettingsCard({
    title,
    description,
    icon: Icon,
    right,
    children,
}: {
    title: string;
    description?: string;
    icon?: LucideIcon;
    right?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70">
            <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />}
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
                        {description && (
                            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{description}</p>
                        )}
                    </div>
                </div>
                {right && <div className="shrink-0">{right}</div>}
            </header>
            <div className="px-5 py-5">{children}</div>
        </section>
    );
}
