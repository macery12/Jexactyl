import { m } from '@/i18n';
import { useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Server, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getServers } from '@/api/servers';
import { getServerResources } from '@/api/serverResources';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { can } from '@/lib/can';
import { StatTiles } from './StatTiles';
import { LiveServerCard } from './LiveServerCard';
import { Announcements } from './Announcements';
import { ActivityFeed } from './ActivityFeed';
import { AccountHealth } from './AccountHealth';

export default function DashboardPage() {
    const user = useSession(s => s.user);
    const held = useAdminHeld();
    const canReadAllServers = can(held, 'servers.read');
    const billingEnabled = useFlags(s => s.everest)?.billing.enabled ?? false;

    // Admins can flip the list between their own servers and every server on the
    // system. The scope is part of the query key so the two lists cache separately.
    const [showAll, setShowAll] = useState(false);
    const scope = canReadAllServers && showAll ? 'admin-all' : undefined;

    const { data: servers, isLoading, isError, error } = useQuery({
        queryKey: ['servers', scope ?? 'own'],
        queryFn: () => getServers(scope),
    });

    // Live per-server usage. Centralised here so the cards stay presentational
    // and the "running" stat can aggregate across all of them. One request per
    // server per tick, so back the cadence off as the list grows — an admin
    // browsing every server on the system would otherwise hammer the API.
    const pollInterval = (servers?.length ?? 0) > 24 ? 60_000 : 10_000;
    const resourceQueries = useQueries({
        queries: (servers ?? []).map(s => ({
            queryKey: ['resources', s.id],
            queryFn: () => getServerResources(s.id),
            refetchInterval: pollInterval,
            enabled: !!servers,
        })),
    });

    const running = servers
        ? resourceQueries.filter(q => q.data?.state === 'running').length
        : null;
    const suspended = servers
        ? resourceQueries.filter(q => q.data?.isSuspended).length
        : null;
    const memUsedBytes = servers
        ? resourceQueries.reduce((sum, q) => sum + (q.data?.memoryBytes ?? 0), 0)
        : null;
    const anyResourcesPending = resourceQueries.some(q => q.isPending);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {user ? m['dashboard.welcomeNamed']({ name: user.username }) : m['dashboard.welcome']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['dashboard.subtitle']()}</p>
                </div>
                {billingEnabled && (
                    <Link
                        to="/billing/order"
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                    >
                        <Plus className="h-4 w-4" /> {m['dashboard.newServer']()}
                    </Link>
                )}
            </div>

            {isLoading && (
                <div className="flex items-center justify-center py-24">
                    <Spinner className="h-7 w-7" />
                </div>
            )}

            {isError && (
                <div className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                    {error instanceof Error ? m['dashboard.loadErrorDetail']({ message: error.message }) : m['dashboard.loadError']()}.
                </div>
            )}

            {!isLoading && !isError && servers && (
                <>
                    <StatTiles
                        servers={servers}
                        running={servers.length ? running : 0}
                        suspended={servers.length ? suspended : 0}
                        memUsedBytes={servers.length ? memUsedBytes : 0}
                    />

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                        <div className="flex flex-col gap-4 xl:col-span-2">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold text-[var(--color-ink-muted)]">
                                    {showAll ? m['dashboard.allServers']() : m['dashboard.yourServers']()}
                                </h2>
                                {canReadAllServers && (
                                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border-strong)] p-0.5">
                                        {([false, true] as const).map(all => (
                                            <button
                                                key={String(all)}
                                                onClick={() => setShowAll(all)}
                                                className={cn(
                                                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                                                    showAll === all
                                                        ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                                                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                                                )}
                                            >
                                                {all ? m['dashboard.scope.all']() : m['dashboard.scope.mine']()}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {servers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-16 text-center">
                                    <Server className="mb-4 h-7 w-7 text-[var(--color-ink-faint)]" />
                                    <h3 className="text-lg font-medium">{m['dashboard.empty.title']()}</h3>
                                    <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">
                                        {m['dashboard.empty.body']()}
                                    </p>
                                    {billingEnabled && (
                                        <Link
                                            to="/billing/order"
                                            className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                                        >
                                            <Plus className="h-4 w-4" /> {m['dashboard.newServer']()}
                                        </Link>
                                    )}
                                </div>
                            ) : (
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {servers.map((s, i) => (
                                        <LiveServerCard
                                            key={s.uuid}
                                            server={s}
                                            resources={resourceQueries[i]?.data}
                                            pending={resourceQueries[i]?.isPending ?? anyResourcesPending}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        <aside className="flex flex-col gap-6">
                            <Announcements />
                            <AccountHealth />
                            <ActivityFeed />
                        </aside>
                    </div>
                </>
            )}
        </div>
    );
}
