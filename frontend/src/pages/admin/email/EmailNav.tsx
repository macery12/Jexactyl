import { NavLink } from 'react-router-dom';
import { td } from '@/i18n/messages';
import {
    Mail,
    Server,
    Plug,
    FlaskConical,
    Bell,
    ScrollText,
    FileCode,
    type LucideIcon,
} from 'lucide-react';
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
const BASE = '/admin/email';

const GROUPS: Group[] = [
    {
        labelKey: 'email.nav.groups.configuration',
        items: [
            { to: BASE, end: true, icon: Mail, labelKey: 'email.nav.overview' },
            { to: `${BASE}/smtp`, icon: Server, labelKey: 'email.nav.smtp' },
            { to: `${BASE}/resend`, icon: Plug, labelKey: 'email.nav.resend' },
            { to: `${BASE}/testing`, icon: FlaskConical, labelKey: 'email.nav.testing' },
        ],
    },
    {
        labelKey: 'email.nav.groups.delivery',
        items: [
            { to: `${BASE}/notifications`, icon: Bell, labelKey: 'email.nav.notifications' },
            { to: `${BASE}/activity`, icon: ScrollText, labelKey: 'email.nav.activity' },
        ],
    },
    {
        labelKey: 'email.nav.groups.content',
        items: [{ to: `${BASE}/templates`, icon: FileCode, labelKey: 'email.nav.templates' }],
    },
];

// In-page secondary navigation for the email section — a left rail on lg+, a
// horizontal scroll strip on small screens. Mirrors BillingNav.
export function EmailNav() {
    return (
        <nav className="flex shrink-0 gap-4 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
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
