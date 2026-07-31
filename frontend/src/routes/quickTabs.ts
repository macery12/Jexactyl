import {
    Plus,
    SlidersHorizontal,
    Boxes,
    Settings2,
    Settings,
    Server,
    HardDrive,
    ShieldCheck,
    Database,
    Activity,
    Egg,
    ToggleRight,
    LayoutTemplate,
    Palette,
    Bell,
    KeyRound,
    CreditCard,
    LifeBuoy,
    Bot,
    Webhook,
    Puzzle,
    Globe,
    Mail,
    Users,
    type LucideIcon,
} from 'lucide-react';
import type { Flags } from './registry';
import { can } from '@/lib/can';

// Quick Tabs — the predefined admin shortcut menus in the top bar.
//
// Deliberately a hand-curated set rather than a mirror of `adminRoutes`: the
// sidebar already lists everything, so the value here is a *short* list of the
// destinations admins reach for most, grouped into a few dropdowns. Editing this
// file is how the set changes — there is no per-user customisation (V1's speed
// dial worked the same way, with a hardcoded action list).
//
// Every entry carries the same `permission` / `condition` gates the route
// registry uses, and `visibleQuickTabs()` applies them, so a tab never offers a
// destination the viewer can't open or whose module is disabled.

export interface QuickTabItem {
    to: string;
    /** English label; resolved through td(`nav.items.${name}`) with this as the fallback. */
    name: string;
    icon: LucideIcon;
    /** Dotted permission(s) required — matched with the same `can()` the nav uses. */
    permission?: string | string[];
    /** Feature-flag gate; hidden when it returns false. */
    condition?: (flags: Flags) => boolean;
}

export interface QuickTab {
    /** Label id: resolved through td(`nav.quickTabs.${key}`) with `name` as the fallback. */
    key: string;
    name: string;
    icon: LucideIcon;
    items: QuickTabItem[];
}

export const QUICK_TABS: QuickTab[] = [
    {
        key: 'create',
        name: 'Create',
        icon: Plus,
        // Only destinations that are real URLs. Users/roles/databases/nests all
        // create in-page (modal or master-detail selection), so they live under
        // Manage rather than pretending to have a /new route.
        items: [
            { to: '/admin/infrastructure/servers/new', name: 'New Server', icon: Server, permission: 'servers.create' },
            { to: '/admin/infrastructure/nodes/new', name: 'New Node', icon: HardDrive, permission: 'nodes.create' },
        ],
    },
    {
        key: 'manage',
        name: 'Manage',
        icon: SlidersHorizontal,
        items: [
            { to: '/admin/infrastructure', name: 'Infrastructure', icon: Server, permission: ['nodes.read', 'servers.read'] },
            { to: '/admin/access/users', name: 'Users', icon: Users, permission: 'users.read' },
            { to: '/admin/access/profiles', name: 'Access Profiles', icon: ShieldCheck, permission: 'roles.read' },
            { to: '/admin/access/api-keys', name: 'API Keys', icon: KeyRound, permission: 'api.read' },
            { to: '/admin/databases', name: 'Databases', icon: Database, permission: 'databases.read' },
            { to: '/admin/nests', name: 'Nests', icon: Egg, permission: 'nests.read' },
            { to: '/admin/activity', name: 'Activity', icon: Activity, permission: 'activity.read' },
        ],
    },
    {
        key: 'modules',
        name: 'Modules',
        icon: Boxes,
        items: [
            { to: '/admin/billing', name: 'Billing', icon: CreditCard, permission: 'billing.read', condition: f => f.billing.enabled },
            { to: '/admin/tickets', name: 'Tickets', icon: LifeBuoy, permission: 'tickets.read', condition: f => f.tickets.enabled },
            { to: '/admin/ai', name: 'AI', icon: Bot, permission: 'ai.read', condition: f => f.ai.enabled },
            { to: '/admin/marketplace', name: 'Marketplace', icon: Boxes, permission: 'mods.read', condition: f => f.mods.enabled },
            { to: '/admin/webhooks', name: 'Webhooks', icon: Webhook, permission: 'webhooks.read', condition: f => f.webhooks.enabled },
            { to: '/admin/extensions', name: 'Extensions', icon: Puzzle, permission: 'extensions.read', condition: f => f.extensions.enabled },
            { to: '/admin/custom-domains', name: 'Custom Domains', icon: Globe, permission: 'custom-domains.read', condition: f => f.custom_domains.enabled },
            { to: '/admin/email', name: 'Email', icon: Mail, permission: 'email.read', condition: f => !!f.email.module_enabled },
        ],
    },
    {
        key: 'system',
        name: 'System',
        icon: Settings2,
        items: [
            { to: '/admin/settings', name: 'Settings', icon: Settings, permission: 'settings.read' },
            { to: '/admin/features', name: 'Features', icon: ToggleRight, permission: 'settings.read' },
            { to: '/admin/landing', name: 'Landing Page', icon: LayoutTemplate, permission: 'settings.read' },
            { to: '/admin/theme', name: 'Theme', icon: Palette, permission: 'theme.read' },
            { to: '/admin/alerts', name: 'Alerts', icon: Bell, permission: 'alerts.read' },
        ],
    },
];

/** True when the viewer may see this entry. Mirrors `buildNav`'s gating: flag
 *  conditions fail **open** while flags are still null, permissions fail closed. */
export function quickTabItemVisible(item: QuickTabItem, flags: Flags | null, held: string[]): boolean {
    if (item.condition && flags && !item.condition(flags)) return false;
    if (item.permission && !can(held, item.permission)) return false;
    return true;
}

/** The tabs to render, with unavailable entries dropped and empty tabs removed. */
export function visibleQuickTabs(flags: Flags | null, held: string[]): QuickTab[] {
    const tabs: QuickTab[] = [];
    for (const tab of QUICK_TABS) {
        const items = tab.items.filter(i => quickTabItemVisible(i, flags, held));
        if (items.length > 0) tabs.push({ ...tab, items });
    }
    return tabs;
}
