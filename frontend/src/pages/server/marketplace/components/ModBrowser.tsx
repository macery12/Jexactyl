import { useMemo, useState } from 'react';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { Spinner } from '@/components/ui/Spinner';
import {
    searchModsPage,
    type Mod,
    type ModSearchParams,
    type ServerModsConfig,
    type Source,
} from '@/api/mods';
import { ModSearchBar, type ModFilters } from './ModSearchBar';
import { VirtualGrid } from './VirtualGrid';
import { ModCard } from './ModCard';
import { ModDetailsModal } from './ModDetailsModal';

const PAGE_SIZE = 24;

// Browses one (resource, source) pair: Modrinth/Spigot mods or plugins. Owns the
// filter state, the infinite query, and the details modal.
export function ModBrowser({
    serverId,
    source,
    resource,
    detected,
}: {
    serverId: string;
    source: Source;
    resource: 'mods' | 'plugins';
    detected: ServerModsConfig | null;
}) {
    const [showAll, setShowAll] = useState(false);
    const [selected, setSelected] = useState<Mod | null>(null);
    const [warningDismissed, setWarningDismissed] = useState(false);

    // Seed filters from the server auto-detection unless the user opted out.
    const [filters, setFilters] = useState<ModFilters>(() => ({
        search: '',
        gameVersion: detected?.detectedVersion ?? undefined,
        modLoaderType: detected?.detectedLoader?.id ?? undefined,
    }));

    const effective = showAll
        ? { search: filters.search, sortField: filters.sortField, categoryId: filters.categoryId, minRating: filters.minRating }
        : filters;

    const params: ModSearchParams = {
        source,
        resource,
        searchFilter: effective.search || undefined,
        gameVersion: effective.gameVersion,
        modLoaderType: effective.modLoaderType,
        platform: effective.platform,
        sortField: effective.sortField,
        categoryId: effective.categoryId,
        minRating: effective.minRating,
        pageSize: PAGE_SIZE,
    };

    const query = useInfiniteQuery({
        queryKey: ['mods', serverId, resource, source, params],
        queryFn: ({ pageParam }) => searchModsPage(serverId, { ...params, index: pageParam }),
        initialPageParam: 0,
        getNextPageParam: last => last.nextIndex,
        placeholderData: keepPreviousData,
    });

    const items = useMemo(() => query.data?.pages.flatMap(p => p.data) ?? [], [query.data]);
    const options = query.data?.pages[0]?.filters?.options;

    // Compatibility hint: mod-loader vs plugin-platform servers.
    const incompatible =
        !warningDismissed &&
        ((resource === 'plugins' && !!detected?.detectedLoader) ||
            (resource === 'mods' && !detected?.detectedLoader && !!detected?.detectedPlatform));

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <ModSearchBar
                serverId={serverId}
                source={source}
                resource={resource}
                filters={filters}
                onChange={setFilters}
                options={options}
                detected={detected}
                showAll={showAll}
                onToggleShowAll={() => setShowAll(s => !s)}
            />

            {incompatible && (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="flex-1">
                        {resource === 'plugins'
                            ? m['server.mods.warn.pluginsOnModServer']()
                            : m['server.mods.warn.modsOnPluginServer']()}
                    </span>
                    <button type="button" onClick={() => setWarningDismissed(true)} aria-label={m['server.mods.filter.clear']()}>
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {query.isError ? (
                <div className="flex flex-1 items-center justify-center py-16 text-sm text-[var(--color-danger)]">
                    {firstError(query.error) ?? m['server.mods.error']()}
                </div>
            ) : query.isLoading ? (
                <div className="flex flex-1 items-center justify-center py-16">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : (
                <VirtualGrid
                    items={items}
                    keyFor={mod => `${mod.id}`}
                    renderItem={mod => <ModCard mod={mod} onSelect={setSelected} />}
                    hasMore={!!query.hasNextPage}
                    isFetchingNext={query.isFetchingNextPage}
                    onLoadMore={() => query.fetchNextPage()}
                    emptyLabel={m['server.mods.empty']()}
                />
            )}

            {selected && (
                <ModDetailsModal
                    serverId={serverId}
                    mod={selected}
                    source={source}
                    resource={resource}
                    onClose={() => setSelected(null)}
                />
            )}
        </div>
    );
}
