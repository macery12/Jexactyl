import { NavLink } from 'react-router-dom';
import { Puzzle, ShieldHalf, UserCheck, type LucideIcon } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';

const BASE = '/admin/auth';

interface Item {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    label: string;
}

// In-page secondary navigation for the auth section. jGuard tabs appear only
// while the module is enabled (matching V1's conditional SubNavigation).
export function AuthNav() {
    const jguardEnabled = Boolean(window.EverestConfiguration?.auth.modules.jguard.enabled);

    const items: Item[] = [
        { to: BASE, end: true, icon: Puzzle, label: m['admin.auth.nav.modules']() },
        ...(jguardEnabled
            ? [
                  { to: `${BASE}/jguard`, end: true, icon: ShieldHalf, label: m['admin.auth.nav.jguard']() },
                  { to: `${BASE}/jguard/pending`, end: true, icon: UserCheck, label: m['admin.auth.nav.pending']() },
              ]
            : []),
    ];

    return (
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:overflow-visible lg:pb-0">
            {items.map(item => (
                <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                        cn(
                            'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                                ? 'bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                        )
                    }
                >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                </NavLink>
            ))}
        </nav>
    );
}
