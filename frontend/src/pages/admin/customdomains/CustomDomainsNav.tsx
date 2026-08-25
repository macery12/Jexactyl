import { NavLink } from 'react-router-dom';
import { m } from '@/i18n/messages';
import { Globe, KeyRound, Cog, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Item {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    label: string;
}

const BASE = '/admin/custom-domains';

const ITEMS: Item[] = [
    { to: BASE, end: true, icon: Globe, label: m['admin.customDomains.nav.domains']() },
    { to: `${BASE}/api-keys`, icon: KeyRound, label: m['admin.customDomains.nav.apiKeys']() },
    { to: `${BASE}/settings`, icon: Cog, label: m['admin.customDomains.nav.settings']() },
];

// In-page left rail for the custom-domains admin module. Mirrors WebhooksNav.
export function CustomDomainsNav() {
    return (
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:overflow-visible lg:pb-0">
            {ITEMS.map(item => (
                <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                        cn(
                            'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                                ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-[var(--brand)]/30'
                                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                        )
                    }
                >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
            ))}
        </nav>
    );
}
