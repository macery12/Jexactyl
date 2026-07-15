import {
    LayoutDashboard,
    Settings,
    Activity,
    KeyRound,
    BookOpen,
    ShieldCheck,
    CreditCard,
    Globe,
    LifeBuoy,
    Bot,
    Boxes,
    Mail,
    Webhook,
    Puzzle,
    Palette,
    LayoutTemplate,
    Bell,
    Database,
    Server,
    Users,
    UserCog,
    Egg,
    ToggleRight,
} from 'lucide-react';
import { lazy } from 'react';
import { route, type RouteDef } from './registry';
import { NodesRedirect, ServersRedirect } from '@/pages/admin/infrastructure/InfraRedirect';

const SettingsSection = lazy(() => import('@/pages/admin/settings/SettingsSection'));
const InfrastructureSection = lazy(() => import('@/pages/admin/infrastructure/InfrastructureSection'));
const ThemeSection = lazy(() => import('@/pages/admin/theme/ThemeSection'));
const ExtensionsSection = lazy(() => import('@/pages/admin/extensions/ExtensionsSection'));
const BillingSection = lazy(() => import('@/pages/admin/billing/BillingSection'));
const LandingSection = lazy(() => import('@/pages/admin/landing/LandingSection'));
const EmailSection = lazy(() => import('@/pages/admin/email/EmailSection'));
const TicketsSection = lazy(() => import('@/pages/admin/tickets/TicketsSection'));
const UsersSection = lazy(() => import('@/pages/admin/users/UsersSection'));
const RolesSection = lazy(() => import('@/pages/admin/roles/RolesSection'));
const MarketplaceSection = lazy(() => import('@/pages/admin/marketplace/MarketplaceSection'));
const AdminActivityPage = lazy(() => import('@/pages/admin/activity/AdminActivityPage'));
const ApiKeysSection = lazy(() => import('@/pages/admin/api/ApiKeysSection'));
const NestsSection = lazy(() => import('@/pages/admin/nests/NestsSection'));
const ApiDocsPage = lazy(() => import('@/pages/admin/apidocs/ApiDocsPage'));
const AuthSection = lazy(() => import('@/pages/admin/auth/AuthSection'));
const WebhooksSection = lazy(() => import('@/pages/admin/webhooks/WebhooksSection'));
const AlertsSection = lazy(() => import('@/pages/admin/alerts/AlertsSection'));
const OverviewPage = lazy(() => import('@/pages/admin/overview/OverviewPage'));
const CustomDomainsSection = lazy(() => import('@/pages/admin/customdomains/CustomDomainsSection'));
const DatabasesSection = lazy(() => import('@/pages/admin/databases/DatabasesSection'));
const FeaturesSection = lazy(() => import('@/pages/admin/features/FeaturesSection'));
const AiSection = lazy(() => import('@/pages/admin/ai/AiSection'));

// Admin area (/v2/admin/*) — sidebar grouped by `category`.
// Seeded from V1_UI_Map §3.4. All entries are placeholders for Phase 1.
export const adminRoutes: RouteDef[] = [
    route('', { name: 'Overview', icon: LayoutDashboard, category: 'general', permission: 'overview.read', end: true, element: OverviewPage }),
    route('settings/*', { name: 'Settings', icon: Settings, category: 'general', permission: 'settings.read', element: SettingsSection }),
    route('features', { name: 'Features', icon: ToggleRight, category: 'general', permission: 'settings.read', element: FeaturesSection }),
    route('landing/*', { name: 'Landing Page', icon: LayoutTemplate, category: 'general', permission: 'settings.read', element: LandingSection }),
    route('activity', { name: 'Activity', icon: Activity, category: 'general', permission: 'activity.read', element: AdminActivityPage }),
    route('api/*', { name: 'API Keys', icon: KeyRound, category: 'general', permission: 'api.read', element: ApiKeysSection }),

    route('developers/api-docs', { name: 'API Docs', icon: BookOpen, category: 'developers', element: ApiDocsPage }),

    route('auth/*', { name: 'Auth', icon: ShieldCheck, category: 'modules', permission: 'auth.read', element: AuthSection }),
    route('billing/*', { name: 'Billing', icon: CreditCard, category: 'modules', permission: 'billing.read', condition: f => f.billing.enabled, element: BillingSection }),
    route('custom-domains/*', { name: 'Custom Domains', icon: Globe, category: 'modules', permission: 'custom-domains.read', condition: f => f.custom_domains.enabled, element: CustomDomainsSection }),
    route('tickets/*', { name: 'Tickets', icon: LifeBuoy, category: 'modules', permission: 'tickets.read', condition: f => f.tickets.enabled, element: TicketsSection }),
    route('ai/*', { name: 'AI', icon: Bot, category: 'modules', permission: 'ai.read', condition: f => f.ai.enabled, element: AiSection }),
    route('marketplace/*', { name: 'Marketplace', icon: Boxes, category: 'modules', permission: 'mods.read', condition: f => f.mods.enabled, element: MarketplaceSection }),
    route('email/*', { name: 'Email', icon: Mail, category: 'modules', condition: f => !!f.email.module_enabled, element: EmailSection }),
    route('webhooks/*', { name: 'Webhooks', icon: Webhook, category: 'modules', permission: 'webhooks.read', condition: f => f.webhooks.enabled, element: WebhooksSection }),
    route('extensions/*', { name: 'Extensions', icon: Puzzle, category: 'modules', condition: f => f.extensions.enabled, element: ExtensionsSection }),
    route('theme', { name: 'Theme', icon: Palette, category: 'modules', element: ThemeSection }),
    route('alerts/*', { name: 'Alerts', icon: Bell, category: 'modules', element: AlertsSection }),

    route('databases/*', { name: 'Databases', icon: Database, category: 'management', permission: 'databases.read', element: DatabasesSection }),
    route('infrastructure/*', { name: 'Infrastructure', icon: Server, category: 'management', permission: ['nodes.read', 'servers.read'], element: InfrastructureSection }),
    // Legacy paths redirect into the merged Infrastructure section (hidden from nav).
    route('nodes/*', { element: NodesRedirect }),
    route('servers/*', { element: ServersRedirect }),
    route('users/*', { name: 'Users', icon: Users, category: 'management', permission: 'users.read', element: UsersSection }),
    route('roles/*', { name: 'Roles', icon: UserCog, category: 'management', permission: 'roles.read', element: RolesSection }),

    route('nests/*', { name: 'Nests', icon: Egg, category: 'services', permission: 'nests.read', element: NestsSection }),
];
