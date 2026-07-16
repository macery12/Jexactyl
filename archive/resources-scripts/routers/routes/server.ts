import { lazy } from 'react';
import {
    ArchiveIcon,
    CashIcon,
    ClockIcon,
    CogIcon,
    DatabaseIcon,
    EyeIcon,
    FolderOpenIcon,
    GlobeIcon,
    PlayIcon,
    PuzzleIcon,
    SparklesIcon,
    TerminalIcon,
    UsersIcon,
    WifiIcon,
} from '@heroicons/react/outline';
import { route, type ServerRouteDefinition } from '@/routers/routes/utils';

const ServerConsoleContainer = lazy(() => import('@server/console/ServerConsoleContainer'));
const ServerSettingsContainer = lazy(() => import('@server/settings/ServerSettingsContainer'));
const FileManagerContainer = lazy(() => import('@server/files/FileManagerContainer'));
const FileEditContainer = lazy(() => import('@server/files/FileEditContainer'));
const DatabasesContainer = lazy(() => import('@server/databases/DatabasesContainer'));
const ScheduleContainer = lazy(() => import('@server/schedules/ScheduleContainer'));
const ScheduleEditContainer = lazy(() => import('@server/schedules/ScheduleEditContainer'));
const UsersContainer = lazy(() => import('@server/users/UsersContainer'));
const BackupContainer = lazy(() => import('@server/backups/BackupContainer'));
const NetworkContainer = lazy(() => import('@server/network/NetworkContainer'));
const StartupContainer = lazy(() => import('@server/startup/StartupContainer'));
const ServerActivityLogContainer = lazy(() => import('@server/ServerActivityLogContainer'));
const ServerBillingContainer = lazy(() => import('@server/billing/ServerBillingContainer'));
const ModsAndPluginsPage = lazy(() => import('@server/plugins/ModsAndPluginsPage'));
const ExtensionsRouter = lazy(() => import('@server/extensions/ExtensionsRouter'));
const CustomDomainsContainer = lazy(() => import('@server/domains/CustomDomainsContainer'));
const ServerAIContainer = lazy(() => import('@server/ai/ServerAIContainer'));

const server: ServerRouteDefinition[] = [
    route('', ServerConsoleContainer, {
        permission: 'control.console',
        name: 'Console',
        end: true,
        icon: TerminalIcon,
    }),
    route('ai/*', ServerAIContainer, {
        name: 'AI Assistant',
        icon: SparklesIcon,
        condition: flags => flags.aiEnabled && flags.aiAssistantEnabled,
    }),
    route('files/*', FileManagerContainer, {
        permission: 'file.*',
        name: 'Files',
        icon: FolderOpenIcon,
        category: 'data',
    }),
    route('files/:action/*', FileEditContainer, { permission: 'file.*' }),
    route('databases/*', DatabasesContainer, {
        permission: 'database.*',
        name: 'Databases',
        icon: DatabaseIcon,
        category: 'data',
    }),
    route('marketplace/*', ModsAndPluginsPage, {
        permission: 'file.create',
        name: 'Mods & Plugins',
        icon: PuzzleIcon,
        category: 'data',
    }),
    route('schedules/*', ScheduleContainer, {
        permission: 'schedule.*',
        name: 'Schedules',
        icon: ClockIcon,
        category: 'configuration',
    }),
    route('schedules/:id/*', ScheduleEditContainer, { permission: 'schedule.*', category: 'configuration' }),
    route('users/*', UsersContainer, {
        permission: 'user.*',
        name: 'Users',
        icon: UsersIcon,
        category: 'configuration',
    }),
    route('backups/*', BackupContainer, {
        permission: 'backup.*',
        name: 'Backups',
        icon: ArchiveIcon,
        category: 'data',
    }),
    route('network/*', NetworkContainer, {
        permission: 'allocation.*',
        name: 'Network',
        icon: WifiIcon,
        category: 'configuration',
    }),
    route('custom-domains/*', CustomDomainsContainer, {
        permission: 'allocation.*',
        name: 'Custom Domains',
        icon: GlobeIcon,
        category: 'configuration',
        condition: flags => flags.customDomainsEnabled,
    }),
    route('startup/*', StartupContainer, {
        permission: 'startup.*',
        name: 'Startup',
        icon: PlayIcon,
        category: 'configuration',
    }),
    route('settings/*', ServerSettingsContainer, {
        permission: 'settings.*',
        name: 'Settings',
        icon: CogIcon,
        category: 'configuration',
    }),
    route('activity/*', ServerActivityLogContainer, {
        permission: 'activity.*',
        name: 'Activity',
        icon: EyeIcon,
        condition: flags => flags.activityEnabled,
    }),
    route('billing/*', ServerBillingContainer, {
        permission: 'billing.*',
        name: 'Billing',
        icon: CashIcon,
        condition: flags => flags.billable,
    }),
    route('extensions/*', ExtensionsRouter, {
        permission: 'extension.*',
        name: 'Extensions',
        icon: PuzzleIcon,
        condition: flags => flags.extensionsEnabled,
    }),
];

export default server;
