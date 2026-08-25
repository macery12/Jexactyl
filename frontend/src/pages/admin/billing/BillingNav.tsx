import { NavLink } from 'react-router-dom';
import { td } from '@/i18n/messages';
import {
    LayoutDashboard,
    Boxes,
    ShoppingCart,
    Store,
    FileText,
    Ticket,
    AlertTriangle,
    Settings,
    Receipt,
    type LucideIcon,
} from 'lucide-react';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { cn } from '@/lib/cn';

interface Item {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    labelKey: string;
    permission?: string;
}
interface Group {
    labelKey: string;
    items: Item[];
}

// Absolute paths — relative `to` would compound against the active route
// (e.g. clicking "Products" while on /billing/products → /billing/products/products).
const BASE = '/admin/billing';

const GROUPS: Group[] = [
    {
        labelKey: 'billing.nav.groups.dashboard',
        items: [{ to: BASE, end: true, icon: LayoutDashboard, labelKey: 'billing.nav.overview', permission: 'billing.read' }],
    },
    {
        labelKey: 'billing.nav.groups.catalog',
        items: [
            { to: `${BASE}/products`, icon: Boxes, labelKey: 'billing.nav.products', permission: 'billing.read' },
            { to: `${BASE}/store`, icon: Store, labelKey: 'billing.nav.storefront', permission: 'billing.update' },
            { to: `${BASE}/coupons`, icon: Ticket, labelKey: 'billing.nav.coupons', permission: 'billing.read' },
        ],
    },
    {
        labelKey: 'billing.nav.groups.transactions',
        items: [
            { to: `${BASE}/orders`, icon: ShoppingCart, labelKey: 'billing.nav.orders', permission: 'billing.orders' },
            { to: `${BASE}/invoices`, icon: FileText, labelKey: 'billing.nav.invoices', permission: 'billing.read' },
        ],
    },
    {
        labelKey: 'billing.nav.groups.system',
        items: [
            { to: `${BASE}/exceptions`, icon: AlertTriangle, labelKey: 'billing.nav.exceptions', permission: 'billing.exceptions' },
            { to: `${BASE}/settings`, icon: Settings, labelKey: 'billing.nav.settings', permission: 'billing.update' },
            { to: `${BASE}/invoice-settings`, icon: Receipt, labelKey: 'billing.nav.invoiceSettings', permission: 'billing.update' },
        ],
    },
];

// In-page secondary navigation for the billing section. Lives inside the
// billing content area (a left rail on lg+, a horizontal scroll strip on small
// screens) — deliberately NOT on the main admin sidebar.
export function BillingNav() {
    const held = useAdminHeld();

    const groups = GROUPS.map(g => ({
        ...g,
        items: g.items.filter(i => can(held, i.permission)),
    })).filter(g => g.items.length > 0);

    return (
        <nav className="flex shrink-0 gap-4 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
            {groups.map(group => (
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
