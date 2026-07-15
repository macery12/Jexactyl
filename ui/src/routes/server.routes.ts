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
const FilesSection = lazy(() => import('@/pages/server/files/FilesSection'));
const StartupPage = lazy(() => import('@/pages/server/startup/StartupPage'));
const NetworkPage = lazy(() => import('@/pages/server/network/NetworkPage'));
const SchedulesSection = lazy(() => import('@/pages/server/schedules/SchedulesSection'));
const UsersSection = lazy(() => import('@/pages/server/users/UsersSection'));
const SettingsPage = lazy(() => import('@/pages/server/settings/SettingsPage'));
const CustomDomainsPage = lazy(() => import('@/pages/server/customdomains/CustomDomainsPage'));
const AiPage = lazy(() => import('@/pages/server/ai/AiPage'));

// Server area (/v2/server/:id/*) — sidebar grouped by `category`.
// Seeded from V1_UI_Map §3.3. The index is the modular widget dashboard
// (console-focal); the rest remain placeholders.
export const serverRoutes: RouteDef[] = [
    route('', { name: 'Console', icon: Terminal, element: ServerOverviewPage, end: true }),
    route('ai/*', { name: 'AI Assistant', icon: Bot, condition: f => f.ai.enabled && f.ai.feature_server_assistant, element: AiPage }),

    route('files/*', { name: 'Files', icon: FolderOpen, permission: 'file.*', category: 'data', element: FilesSection }),
    route('databases/*', { name: 'Databases', icon: Database, permission: 'database.*', category: 'data' }),
    route('marketplace/*', { name: 'Mods & Plugins', icon: Boxes, permission: 'file.create', category: 'data', condition: f => f.mods.enabled, element: MarketplaceSection }),
    route('backups/*', { name: 'Backups', icon: Archive, permission: 'backup.*', category: 'data' }),

    // Ordered by how often operators reach for each (startup → network →
    // automation → team → admin), keeping each a distinct permission-gated tab.
    route('startup/*', { name: 'Startup', icon: SlidersHorizontal, permission: 'startup.*', category: 'configuration', element: StartupPage }),
    route('network/*', { name: 'Network', icon: Network, permission: 'allocation.*', category: 'configuration', element: NetworkPage }),
    route('custom-domains/*', { name: 'Custom Domains', icon: Globe, category: 'configuration', condition: f => f.custom_domains.enabled, element: CustomDomainsPage }),
    route('schedules/*', { name: 'Schedules', icon: CalendarClock, permission: 'schedule.*', category: 'configuration', element: SchedulesSection }),
    route('users/*', { name: 'Users', icon: Users, permission: 'user.*', category: 'configuration', element: UsersSection }),
    route('settings/*', { name: 'Settings', icon: Settings, permission: 'settings.*', category: 'configuration', element: SettingsPage }),

    route('activity/*', { name: 'Activity', icon: Activity }),
    route('billing/*', { name: 'Billing', icon: CreditCard, condition: f => f.billing.enabled }),
    route('extensions/*', { name: 'Extensions', icon: Puzzle, permission: 'extension.*', condition: f => f.extensions.enabled }),
];
