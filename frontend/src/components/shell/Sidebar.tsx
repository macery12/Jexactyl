import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { td } from '@/i18n/messages';
import type { NavGroup } from '@/routes/nav';
import { cn } from '@/lib/cn';

// `footer` renders below the registry-driven groups, for nav entries that
// aren't routes (the account area passes operator-defined external links).
export function Sidebar({
    groups,
    onNavigate,
    footer,
}: {
    groups: NavGroup[];
    onNavigate?: () => void;
    footer?: ReactNode;
}) {
    // Nav labels come from the route registry (dynamic English strings); look
    // each up under nav.items.* with the English name as the fallback so an
    // unregistered route still renders. Categories are a fixed set.
    const itemLabel = (name: string) => td(`nav.items.${name}`, name);
    const categoryLabel = (cat: string) => td(`nav.category.${cat}`, cat);

    return (
        <nav className="flex flex-col gap-6 p-4">
            {groups.map((group, i) => (
                <div key={group.category ?? `g${i}`} className="flex flex-col gap-1">
                    {group.category && (
                        <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                            {categoryLabel(group.category)}
                        </p>
                    )}
                    {group.items.map(item => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            onClick={onNavigate}
                            className={({ isActive }) =>
                                cn(
                                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-[var(--brand)]/30'
                                        : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                                )
                            }
                        >
                            {item.icon && <item.icon className="h-[18px] w-[18px] shrink-0" />}
                            <span className="truncate">{itemLabel(item.name)}</span>
                        </NavLink>
                    ))}
                </div>
            ))}
            {footer}
        </nav>
    );
}
