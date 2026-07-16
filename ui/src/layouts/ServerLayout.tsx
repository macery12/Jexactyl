import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { RequireAuth } from './RequireAuth';
import { serverRoutes } from '@/routes/server.routes';
import { buildNav } from '@/routes/nav';
import { useFlags } from '@/state/flags';
import { getServer } from '@/api/servers';
import { ServerContext } from '@/components/server/ServerContext';
import { ServerHeader } from '@/components/server/ServerHeader';
import { useServerSocketConnection } from '@/hooks/useServerSocket';
import { FullPageSpinner } from '@/components/ui/Spinner';

export default function ServerLayout() {
    const { id } = useParams();
    const flags = useFlags(s => s.everest);

    const { data: server, isLoading, isError } = useQuery({
        queryKey: ['server', id],
        queryFn: () => getServer(id!),
        enabled: !!id,
    });

    // Open the daemon websocket for the active server (status + stats stream).
    useServerSocketConnection(server?.uuid);

    // Sidebar permissions come from the real subuser permission set once loaded.
    const held = server?.permissions ?? [];
    const groups = useMemo(
        () => buildNav(serverRoutes, { flags, held, basePath: `/server/${id}` }),
        [flags, held, id],
    );

    return (
        <RequireAuth>
            {isLoading ? (
                <FullPageSpinner />
            ) : isError || !server ? (
                <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-[var(--color-danger)]">
                    Couldn’t load this server. You may not have access, or it no longer exists.
                </div>
            ) : (
                <ServerContext.Provider value={server}>
                    <AppShell groups={groups} header={<ServerHeader />} />
                </ServerContext.Provider>
            )}
        </RequireAuth>
    );
}
