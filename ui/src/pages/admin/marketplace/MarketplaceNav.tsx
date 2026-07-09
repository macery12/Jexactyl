import { NavLink } from 'react-router-dom';
import { td } from '@/i18n';
import { LayoutDashboard, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Item {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    labelKey: string;
}

const BASE = '/v2/admin/marketplace';

const ITEMS: Item[] = [
    { to: BASE, end: true, icon: LayoutDashboard, labelKey: 'admin.marketplace.nav.overview' },
    { to: `${BASE}/settings`, icon: Settings, labelKey: 'admin.marketplace.nav.settings' },
    { to: `${BASE}/providers`, icon: ShieldCheck, labelKey: 'admin.marketplace.nav.providers' },
];

// In-page secondary navigation for the admin marketplace section — mirrors
// EmailNav (left rail on lg+, horizontal strip on small screens).
export function MarketplaceNav() {
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
                    <span className="whitespace-nowrap">{td(item.labelKey)}</span>
                </NavLink>
            ))}
        </nav>
    );
}
