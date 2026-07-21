import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// One slim row inside a flush SettingsCard (the "Sign-in & security" card):
// icon, label + one-line description, then a right-aligned status badge and
// action button. Any modals the row owns are rendered as extra children.
export function SettingsRow({
    icon: Icon,
    title,
    description,
    badge,
    action,
    children,
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    badge?: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            <Icon className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                {badge}
                {action}
            </div>
            {children}
        </div>
    );
}
