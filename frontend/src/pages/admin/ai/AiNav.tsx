import { NavLink } from 'react-router-dom';
import {
    Activity,
    Bot,
    Gauge,
    ListOrdered,
    Plug,
    ShieldCheck,
    SlidersHorizontal,
    Wallet,
    Wrench,
    type LucideIcon,
} from 'lucide-react';
import { td } from '@/i18n/messages';
import { cn } from '@/lib/cn';

interface Item {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    labelKey: string;
}
interface Group {
    labelKey: string;
    items: Item[];
}

// Absolute paths — relative `to` would compound against the active route.
const BASE = '/admin/ai';

const GROUPS: Group[] = [
    {
        labelKey: 'ai.nav.groups.connection',
        items: [
            { to: BASE, end: true, icon: Activity, labelKey: 'ai.nav.overview' },
            { to: `${BASE}/provider`, icon: Plug, labelKey: 'ai.nav.provider' },
            { to: `${BASE}/generation`, icon: SlidersHorizontal, labelKey: 'ai.nav.generation' },
        ],
    },
    {
        labelKey: 'ai.nav.groups.assistants',
        items: [
            { to: `${BASE}/agent`, icon: Bot, labelKey: 'ai.nav.agent' },
            { to: `${BASE}/tools`, icon: Wrench, labelKey: 'ai.nav.tools' },
            { to: `${BASE}/privacy`, icon: ShieldCheck, labelKey: 'ai.nav.privacy' },
        ],
    },
    {
        labelKey: 'ai.nav.groups.operations',
        items: [
            { to: `${BASE}/performance`, icon: Gauge, labelKey: 'ai.nav.performance' },
            { to: `${BASE}/limits`, icon: Wallet, labelKey: 'ai.nav.limits' },
            { to: `${BASE}/logs`, icon: ListOrdered, labelKey: 'ai.nav.logs' },
        ],
    },
];

// In-page secondary navigation for the AI section — a left rail on lg+, a
// horizontal scroll strip on small screens. Mirrors EmailNav.
//
// Every item is always shown, including ones whose settings the configured
// provider ignores. Those pages explain themselves instead; a rail that
// reshuffles when you change a dropdown is worse than a page that says why it
// is empty.
export function AiNav() {
    return (
        <nav className="flex w-full min-w-0 max-w-full shrink-0 gap-4 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
            {GROUPS.map(group => (
                <div key={group.labelKey} className="flex shrink-0 flex-col gap-1">
                    <p className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)] lg:block">
                        {td(`admin.${group.labelKey}`)}
                    </p>
                    <div className="flex gap-1 lg:flex-col">
                        {group.items.map(item => (
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
                                <span className="whitespace-nowrap">{td(`admin.${item.labelKey}`)}</span>
                            </NavLink>
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}
