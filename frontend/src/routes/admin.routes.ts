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
    Egg,
    ToggleRight,
    Link2,
    Users,
    UserCog,
    Sparkles,
    ListOrdered,
} from 'lucide-react';
import { lazy } from 'react';
import { route, type RouteDef } from './registry';
import { extensionAdminRoutes } from './extensionAdmin.routes';
import { NodesRedirect, ServersRedirect } from '@/pages/admin/infrastructure/InfraRedirect';
import {
    AccessIndexRedirect,
    ApiKeysAccessRedirect,
    PeopleAccessRedirect,
    RolesAccessRedirect,
    UsersAccessRedirect,
} from '@/pages/admin/access/AccessRedirect';

const SettingsSection = lazy(() => import('@/pages/admin/settings/SettingsSection'));
const InfrastructureSection = lazy(() => import('@/pages/admin/infrastructure/InfrastructureSection'));
const ThemeSection = lazy(() => import('@/pages/admin/theme/ThemeSection'));
const ExtensionsSection = lazy(() => import('@/pages/admin/extensions/ExtensionsSection'));
const BillingSection = lazy(() => import('@/pages/admin/billing/BillingSection'));
const LandingSection = lazy(() => import('@/pages/admin/landing/LandingSection'));
const EmailSection = lazy(() => import('@/pages/admin/email/EmailSection'));
const TicketsSection = lazy(() => import('@/pages/admin/tickets/TicketsSection'));
const UsersSection = lazy(() => import('@/pages/admin/users/UsersSection'));
const AccessProfilesSection = lazy(() => import('@/pages/admin/roles/RolesSection'));
const ApiKeysSection = lazy(() => import('@/pages/admin/api/ApiKeysSection'));
const MarketplaceSection = lazy(() => import('@/pages/admin/marketplace/MarketplaceSection'));
const AdminActivityPage = lazy(() => import('@/pages/admin/activity/AdminActivityPage'));
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
const AssistantPage = lazy(() => import('@/pages/admin/assistant/AssistantPage'));
const LinksSection = lazy(() => import('@/pages/admin/links/LinksSection'));
const AdminIndexRedirect = lazy(() => import('@/pages/admin/overview/AdminIndexRedirect'));
const QueuesPage = lazy(() => import('@/pages/admin/queues/QueuesPage'));

// Admin area (/admin/*) — sidebar grouped by `category`.
// Seeded from V1_UI_Map §3.4. All entries are placeholders for Phase 1.
export const adminRoutes: RouteDef[] = [
    route('', { element: AdminIndexRedirect }),

    // The admin assistant, deliberately first and deliberately category-less.
    // `buildNav` groups in registry order and renders no heading for an entry
    // with no category, so this lands alone above General rather than as one
    // more item in a list of twenty. It is the only page here you hold a
    // conversation with; burying it under a heading was what made it feel like
    // a settings screen.
    route('assistant', {
        name: 'AI Assistant',
        icon: Sparkles,
        permission: 'ai.read',
        condition: f => f.ai.enabled && f.ai.feature_admin_agent,
        end: true,
        element: AssistantPage,
    }),

    route('overview', { name: 'Overview', icon: LayoutDashboard, category: 'general', permission: 'overview.read', end: true, element: OverviewPage }),
    route('settings/*', { name: 'Settings', icon: Settings, category: 'general', permission: 'settings.read', element: SettingsSection }),
    route('features', { name: 'Features', icon: ToggleRight, category: 'general', permission: 'settings.read', element: FeaturesSection }),
    route('landing/*', { name: 'Landing Page', icon: LayoutTemplate, category: 'general', permission: 'settings.read', element: LandingSection }),
    route('activity', { name: 'Activity', icon: Activity, category: 'general', permission: 'activity.read', element: AdminActivityPage }),
    route('theme', { name: 'Theme', icon: Palette, category: 'general', permission: 'theme.read', element: ThemeSection }),

    // Access Control — one sidebar entry per surface rather than a tab strip
    // inside a single page. `buildNav` groups by category in registry order, so
    // these form their own section directly under General, and the command
    // palette (which reads the same registry) gains an entry for each.
    route('access/users/*', { name: 'Users', icon: Users, category: 'access', permission: 'users.read', element: UsersSection }),
    route('access/profiles/*', { name: 'Access Profiles', icon: UserCog, category: 'access', permission: 'roles.read', element: AccessProfilesSection }),
    route('access/api-keys/*', { name: 'API Keys', icon: KeyRound, category: 'access', permission: 'api.read', element: ApiKeysSection }),
    route('auth/*', { name: 'Auth', icon: ShieldCheck, category: 'access', permission: 'auth.read', element: AuthSection }),
    // Bare /admin/access has no page of its own now; send it to the first
    // section the viewer may open.
    route('access', { element: AccessIndexRedirect }),

    route('billing/*', { name: 'Billing', icon: CreditCard, category: 'modules', permission: 'billing.read', condition: f => f.billing.enabled, element: BillingSection }),
    route('custom-domains/*', { name: 'Custom Domains', icon: Globe, category: 'modules', permission: 'custom-domains.read', condition: f => f.custom_domains.enabled, element: CustomDomainsSection }),
    route('tickets/*', { name: 'Tickets', icon: LifeBuoy, category: 'modules', permission: 'tickets.read', condition: f => f.tickets.enabled, element: TicketsSection }),
    route('ai/*', { name: 'AI', icon: Bot, category: 'modules', permission: 'ai.read', condition: f => f.ai.enabled, element: AiSection }),
    route('marketplace/*', { name: 'Marketplace', icon: Boxes, category: 'modules', permission: 'mods.read', condition: f => f.mods.enabled, element: MarketplaceSection }),
    route('email/*', { name: 'Email', icon: Mail, category: 'modules', permission: 'email.read', condition: f => !!f.email.module_enabled, element: EmailSection }),
    route('webhooks/*', { name: 'Webhooks', icon: Webhook, category: 'modules', permission: 'webhooks.read', condition: f => f.webhooks.enabled, element: WebhooksSection }),
    route('extensions/*', { name: 'Extensions', icon: Puzzle, category: 'modules', permission: 'extensions.read', condition: f => f.extensions.enabled, element: ExtensionsSection }),
    route('alerts/*', { name: 'Alerts', icon: Bell, category: 'modules', permission: 'alerts.read', element: AlertsSection }),
    // V1 filed Links under its 'appearance' category alongside Theme and Alerts;
    // V2 has no such category, so it joins the other feature modules here. No
    // feature flag — the per-link `visible` column is the operator's off switch
    // (V1 parity).
    route('links', { name: 'Links', icon: Link2, category: 'modules', permission: 'links.read', element: LinksSection }),

    route('databases/*', { name: 'Databases', icon: Database, category: 'management', permission: 'databases.read', element: DatabasesSection }),
    route('infrastructure/*', { name: 'Infrastructure', icon: Server, category: 'management', permission: ['nodes.read', 'servers.read'], element: InfrastructureSection }),
    route('nests/*', { name: 'Nests', icon: Egg, category: 'management', permission: 'nests.read', element: NestsSection }),

    // Background work. Sits under Management rather than General because it is
    // about the machinery, not the panel's own settings.
    route('queues', { name: 'Queues', icon: ListOrdered, category: 'management', permission: 'overview.read', end: true, element: QueuesPage }),
    // Legacy paths redirect into the merged Infrastructure section (hidden from nav).
    route('nodes/*', { element: NodesRedirect }),
    route('servers/*', { element: ServersRedirect }),
    // Compatibility redirects for bookmarks and integrations targeting the
    // previous standalone access-management pages, plus `access/people` from the
    // short-lived tabbed section.
    route('users/*', { element: UsersAccessRedirect }),
    route('roles/*', { element: RolesAccessRedirect }),
    route('api/*', { element: ApiKeysAccessRedirect }),
    route('access/people/*', { element: PeopleAccessRedirect }),

    // Admin pages contributed by installed extension packages. Appended here so
    // they group into their own trailing sidebar section; their static
    // extensions/<route>/* paths outrank the extensions/* management splat.
    ...extensionAdminRoutes,

    // Developers stays a single-item category on purpose, pinned below the
    // extension sections at the very bottom of the sidebar.
    route('developers/api-docs', { name: 'API Docs', icon: BookOpen, category: 'developers', permission: 'api.read', element: ApiDocsPage }),
];
