import { useMemo } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { RequireAuth } from './RequireAuth';
import { adminRoutes } from '@/routes/admin.routes';
import { buildNav } from '@/routes/nav';
import { useFlags } from '@/state/flags';
import { useAdminHeld } from './heldPermissions';

export default function AdminLayout() {
    const flags = useFlags(s => s.everest);
    const held = useAdminHeld();
    const groups = useMemo(
        () => buildNav(adminRoutes, { flags, held, basePath: '/admin' }),
        [flags, held],
    );

    return (
        <RequireAuth>
            <AppShell groups={groups} />
        </RequireAuth>
    );
}
