import {
    Server,
    HardDrive,
    Package,
    Tags,
    Receipt,
    FileText,
    MailCheck,
    LayoutTemplate,
    Radio,
    UserCheck,
    Store,
    type LucideIcon,
} from 'lucide-react';
import type { Flags } from '@/routes/registry';

// Command palette actions — the "do a thing" half of Cmd/Ctrl+K. The other half
// ("go to <admin page>") is generated from the route registry via buildNav, so
// it stays in sync automatically and is deliberately NOT duplicated here.
//
// What earns a place in this list: real, directly-linkable URLs that the sidebar
// does not surface — create screens and useful sub-pages buried a click or two
// deep. Anything reachable straight from the nav is already covered by the
// generated "go to" half.

export type CommandGroup = 'create' | 'open';

export interface CommandAction {
    /** Label id: resolved through td(`nav.commands.${id}`) with `name` as the fallback. */
    id: string;
    name: string;
    icon: LucideIcon;
    to: string;
    group: CommandGroup;
    /** Extra English search terms, so "add server" finds "New Server". */
    keywords?: string;
    permission?: string | string[];
    condition?: (flags: Flags) => boolean;
}

export const COMMAND_ACTIONS: CommandAction[] = [
    // — Create ————————————————————————————————————————————————
    {
        id: 'newServer',
        name: 'New Server',
        icon: Server,
        to: '/admin/infrastructure/servers/new',
        group: 'create',
        keywords: 'add create deploy provision',
        permission: 'servers.create',
    },
    {
        id: 'newNode',
        name: 'New Node',
        icon: HardDrive,
        to: '/admin/infrastructure/nodes/new',
        group: 'create',
        keywords: 'add create wings daemon machine',
        permission: 'nodes.create',
    },
    {
        id: 'newProduct',
        name: 'New Product',
        icon: Package,
        to: '/admin/billing/products/new',
        group: 'create',
        keywords: 'add create plan billing shop',
        permission: 'billing.product-create',
        condition: f => f.billing.enabled,
    },
    {
        id: 'newCategory',
        name: 'New Product Category',
        icon: Tags,
        to: '/admin/billing/products/categories/new',
        group: 'create',
        keywords: 'add create billing shop group',
        permission: 'billing.category-create',
        condition: f => f.billing.enabled,
    },

    // — Open (deep links the sidebar doesn't reach) ————————————————
    {
        id: 'orders',
        name: 'Orders',
        icon: Receipt,
        to: '/admin/billing/orders',
        group: 'open',
        keywords: 'billing purchases sales',
        permission: 'billing.orders',
        condition: f => f.billing.enabled,
    },
    {
        id: 'invoices',
        name: 'Invoices',
        icon: FileText,
        to: '/admin/billing/invoices',
        group: 'open',
        keywords: 'billing receipts',
        permission: 'billing.read',
        condition: f => f.billing.enabled,
    },
    {
        id: 'emailTemplates',
        name: 'Email Templates',
        icon: LayoutTemplate,
        to: '/admin/email/templates',
        group: 'open',
        keywords: 'mail message layout',
        permission: 'email.read',
        condition: f => !!f.email.module_enabled,
    },
    {
        id: 'emailTesting',
        name: 'Send Test Email',
        icon: MailCheck,
        to: '/admin/email/testing',
        group: 'open',
        keywords: 'mail smtp check deliverability',
        permission: 'email.read',
        condition: f => !!f.email.module_enabled,
    },
    {
        id: 'webhookEvents',
        name: 'Webhook Events',
        icon: Radio,
        to: '/admin/webhooks/events',
        group: 'open',
        keywords: 'hooks triggers payload',
        permission: 'webhooks.read',
        condition: f => f.webhooks.enabled,
    },
    {
        id: 'jguardPending',
        name: 'Pending Approvals',
        icon: UserCheck,
        to: '/admin/auth/jguard/pending',
        group: 'open',
        keywords: 'jguard registration queue moderation',
        permission: 'auth.read',
    },
    {
        id: 'marketplaceProviders',
        name: 'Marketplace Providers',
        icon: Store,
        to: '/admin/marketplace/providers',
        group: 'open',
        keywords: 'mods plugins sources',
        permission: 'mods.read',
        condition: f => f.mods.enabled,
    },
];
