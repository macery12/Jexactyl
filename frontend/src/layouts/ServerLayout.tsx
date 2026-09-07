import { lazy, Suspense, useMemo } from 'react';
import { useMatch, useParams } from 'react-router-dom';
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

const AgentDrawer = lazy(() =>
    import('@/components/ai/AgentDrawer').then(module => ({ default: module.AgentDrawer })),
);

function ServerLoadingHeader() {
    return (
        <div
            aria-hidden="true"
            className="flex min-h-[6.6875rem] animate-pulse flex-col justify-between gap-3 sm:min-h-9 sm:flex-row sm:items-center"
        >
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-[var(--color-surface-2)]" />
                <div className="space-y-2">
                    <div className="h-5 w-48 rounded bg-[var(--color-surface-2)]" />
                    <div className="h-3 w-32 rounded bg-[var(--color-surface-2)]" />
                </div>
            </div>
            <div className="flex gap-2">
                <div className="h-8 w-28 rounded-sm bg-[var(--color-surface-2)]" />
                <div className="h-8 w-20 rounded-sm bg-[var(--color-surface-2)]" />
            </div>
        </div>
    );
}

export default function ServerLayout() {
    const { id } = useParams();
    const flags = useFlags(s => s.everest);
    const agentEnabled = Boolean(flags?.ai.enabled && flags.ai.feature_agent);
    const onAiPage = Boolean(useMatch('/server/:id/ai/*'));

    const { data: server, isLoading, isError } = useQuery({
        queryKey: ['server', id],
        queryFn: () => getServer(id!),
        enabled: !!id,
    });

    // Open the daemon websocket for the active server (status + stats stream).
    useServerSocketConnection(server?.uuid);

    // Sidebar permissions come from the real subuser permission set once loaded.
    const groups = useMemo(
        () => buildNav(serverRoutes, { flags, held: server?.permissions ?? [], basePath: `/server/${id}` }),
        [flags, server?.permissions, id],
    );

    return (
        <RequireAuth>
            {isLoading ? (
                <AppShell groups={[]} header={<ServerLoadingHeader />} loading />
            ) : isError || !server ? (
                <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-[var(--color-danger)]">
                    Couldn’t load this server. You may not have access, or it no longer exists.
                </div>
            ) : (
                <ServerContext.Provider value={server}>
                    <AppShell groups={groups} header={<ServerHeader />} />
                    {/* Keep the disabled feature out of the browser graph. The
                        drawer remains inside the provider so an enabled agent
                        reaches the same server context the pages do. */}
                    {agentEnabled && !onAiPage && (
                        <Suspense fallback={null}>
                            <AgentDrawer />
                        </Suspense>
                    )}
                </ServerContext.Provider>
            )}
        </RequireAuth>
    );
}
