import { lazy } from 'react';
import {
    Terminal,
    Bot,
    FolderOpen,
    Database,
    Boxes,
    CalendarClock,
    Users,
    Archive,
    Network,
    Globe,
    SlidersHorizontal,
    Settings,
    Activity,
    CreditCard,
    Puzzle,
} from 'lucide-react';
import { route, type RouteDef } from './registry';

const ServerOverviewPage = lazy(() => import('@/pages/server/ServerOverviewPage'));
const MarketplaceSection = lazy(() => import('@/pages/server/marketplace/MarketplaceSection'));

// Server area (/v2/server/:id/*) — sidebar grouped by `category`.
// Seeded from V1_UI_Map §3.3. The index is the modular widget dashboard
// (console-focal); the rest remain placeholders.
export const serverRoutes: RouteDef[] = [
    route('', { name: 'Console', icon: Terminal, element: ServerOverviewPage, end: true }),
    route('ai/*', { name: 'AI Assistant', icon: Bot, condition: f => f.ai.enabled && f.ai.feature_server_assistant }),

    route('files/*', { name: 'Files', icon: FolderOpen, permission: 'file.*', category: 'data' }),
    route('databases/*', { name: 'Databases', icon: Database, permission: 'database.*', category: 'data' }),
    route('marketplace/*', { name: 'Mods & Plugins', icon: Boxes, permission: 'file.create', category: 'data', condition: f => f.mods.enabled, element: MarketplaceSection }),
    route('backups/*', { name: 'Backups', icon: Archive, permission: 'backup.*', category: 'data' }),

    route('schedules/*', { name: 'Schedules', icon: CalendarClock, permission: 'schedule.*', category: 'configuration' }),
    route('users/*', { name: 'Users', icon: Users, permission: 'user.*', category: 'configuration' }),
    route('network/*', { name: 'Network', icon: Network, permission: 'allocation.*', category: 'configuration' }),
    route('custom-domains/*', { name: 'Custom Domains', icon: Globe, category: 'configuration', condition: f => f.custom_domains.enabled }),
    route('startup/*', { name: 'Startup', icon: SlidersHorizontal, permission: 'startup.*', category: 'configuration' }),
    route('settings/*', { name: 'Settings', icon: Settings, permission: 'settings.*', category: 'configuration' }),

    route('activity/*', { name: 'Activity', icon: Activity }),
    route('billing/*', { name: 'Billing', icon: CreditCard, condition: f => f.billing.enabled }),
    route('extensions/*', { name: 'Extensions', icon: Puzzle, permission: 'extension.*', condition: f => f.extensions.enabled }),
];
