import { Navigate } from 'react-router-dom';
import { can } from '@/lib/can';
import { useAdminPermissions } from '@/layouts/heldPermissions';
import { Spinner } from '@/components/ui/Spinner';
import AccessDenied from '@/pages/_shared/AccessDenied';
import { useFlags } from '@/state/flags';
import type { Flags } from '@/routes/registry';

const DESTINATIONS: {
    to: string;
    permission: string | string[];
    condition?: (flags: Flags) => boolean;
}[] = [
    { to: '/admin/overview', permission: 'overview.read' },
    { to: '/admin/access/users', permission: 'users.read' },
    { to: '/admin/access/profiles', permission: 'roles.read' },
    { to: '/admin/access/api-keys', permission: 'api.read' },
    { to: '/admin/settings', permission: 'settings.read' },
    { to: '/admin/infrastructure', permission: ['nodes.read', 'servers.read'] },
    { to: '/admin/activity', permission: 'activity.read' },
    { to: '/admin/auth', permission: 'auth.read' },
    { to: '/admin/billing', permission: 'billing.read', condition: flags => flags.billing.enabled },
    {
        to: '/admin/custom-domains',
        permission: 'custom-domains.read',
        condition: flags => flags.custom_domains.enabled,
    },
    { to: '/admin/tickets', permission: 'tickets.read', condition: flags => flags.tickets.enabled },
    { to: '/admin/ai', permission: 'ai.read', condition: flags => flags.ai.enabled },
    { to: '/admin/marketplace', permission: 'mods.read', condition: flags => flags.mods.enabled },
    { to: '/admin/email', permission: 'email.read', condition: flags => Boolean(flags.email.module_enabled) },
    { to: '/admin/webhooks', permission: 'webhooks.read', condition: flags => flags.webhooks.enabled },
    { to: '/admin/extensions', permission: 'extensions.read', condition: flags => flags.extensions.enabled },
    { to: '/admin/theme', permission: 'theme.read' },
    { to: '/admin/alerts', permission: 'alerts.read' },
    { to: '/admin/links', permission: 'links.read' },
    { to: '/admin/databases', permission: 'databases.read' },
    { to: '/admin/nests', permission: 'nests.read' },
];

export default function AdminIndexRedirect() {
    const { held, isLoading } = useAdminPermissions();
    const flags = useFlags(state => state.everest);

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const destination = DESTINATIONS.find(
        item => can(held, item.permission) && (!item.condition || !flags || item.condition(flags)),
    );
    return destination ? <Navigate to={destination.to} replace /> : <AccessDenied />;
}
