import { useMemo } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CustomLinks } from '@/components/shell/CustomLinks';
import { RequireAuth } from './RequireAuth';
import { accountRoutes } from '@/routes/account.routes';
import { buildNav } from '@/routes/nav';
import { useFlags } from '@/state/flags';

export default function DashboardLayout() {
    const flags = useFlags(s => s.everest);
    const groups = useMemo(
        () => buildNav(accountRoutes, { flags, held: [], basePath: '/account' }),
        [flags],
    );

    return (
        <RequireAuth>
            {/* Custom links live in the account sidebar only — V1 rendered them
                from DashboardRouter, not the admin or server chrome. */}
            <AppShell groups={groups} sidebarFooter={<CustomLinks />} />
        </RequireAuth>
    );
}
