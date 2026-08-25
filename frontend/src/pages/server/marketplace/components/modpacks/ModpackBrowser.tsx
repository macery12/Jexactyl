import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import type { Mod } from '@/api/mods';
import {
    searchModpacksPage,
    getModpackMinecraftVersions,
    type ModpackSearchParams,
} from '@/api/modpacks';
import { VirtualGrid } from '../VirtualGrid';
import { ModCard } from '../ModCard';
import { ModpackDetailsModal } from './ModpackDetailsModal';

const PAGE_SIZE = 24;
const LOADERS = ['forge', 'neoforge', 'fabric', 'quilt'];

// CurseForge modpack browser. Same virtualized-grid engine as ModBrowser, with
// version + loader filters and a dedicated install-wizard modal.
export function ModpackBrowser({ serverId }: { serverId: string }) {
    const [text, setText] = useState('');
    const [search, setSearch] = useState('');
    const [gameVersion, setGameVersion] = useState('');
    const [loader, setLoader] = useState('');
    const [selected, setSelected] = useState<Mod | null>(null);

    // Debounce search input.
    useEffect(() => {
        const t = setTimeout(() => setSearch(text), 400);
        return () => clearTimeout(t);
    }, [text]);

    const versionsQ = useQuery({
        queryKey: ['modpacks', serverId, 'mc-versions'],
        queryFn: () => getModpackMinecraftVersions(serverId),
        staleTime: 60 * 60_000,
    });

    const params: ModpackSearchParams = {
        searchFilter: search || undefined,
        gameVersion: gameVersion || undefined,
        loader: loader || undefined,
        pageSize: PAGE_SIZE,
    };

    const query = useInfiniteQuery({
        queryKey: ['modpacks', serverId, params],
        queryFn: ({ pageParam }) => searchModpacksPage(serverId, { ...params, index: pageParam }),
        initialPageParam: 0,
        getNextPageParam: last => last.nextIndex,
        placeholderData: keepPreviousData,
    });

    const items = useMemo(() => query.data?.pages.flatMap(p => p.data) ?? [], [query.data]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={m['server.mods.modpacks.searchPlaceholder']()}
                        className="pl-9"
                    />
                    {text && (
                        <button
                            type="button"
                            onClick={() => setText('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                            aria-label={m['server.mods.filter.clear']()}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
                <div className="w-40">
                    <Select
                        value={gameVersion}
                        onChange={setGameVersion}
                        options={[
                            { value: '', label: m['server.mods.filter.anyVersion']() },
                            ...(versionsQ.data?.data ?? []).map(v => ({ value: v, label: v })),
                        ]}
                        placeholder={m['server.mods.filter.anyVersion']()}
                    />
                </div>
                <div className="w-36">
                    <Select
                        value={loader}
                        onChange={setLoader}
                        options={[
                            { value: '', label: m['server.mods.filter.anyLoader']() },
                            ...LOADERS.map(l => ({ value: l, label: l.charAt(0).toUpperCase() + l.slice(1) })),
                        ]}
                        placeholder={m['server.mods.filter.anyLoader']()}
                    />
                </div>
            </div>

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
                <ModpackDetailsModal serverId={serverId} modpack={selected} onClose={() => setSelected(null)} />
            )}
        </div>
    );
}
