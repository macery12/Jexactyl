import { NavLink } from 'react-router-dom';
import { m } from '@/i18n';
import { Cog, CalendarClock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Item {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    label: string;
}

// Absolute paths — relative `to` would compound against the active route.
const BASE = '/admin/webhooks';

const ITEMS: Item[] = [
    { to: BASE, end: true, icon: Cog, label: m['admin.webhooks.nav.configuration']() },
    { to: `${BASE}/events`, icon: CalendarClock, label: m['admin.webhooks.nav.events']() },
];

// In-page secondary navigation for the webhooks section — a left rail on lg+, a
// horizontal scroll strip on small screens. Mirrors EmailNav / BillingNav.
export function WebhooksNav() {
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
