import { useEffect, useRef, useState } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import { useStoreState } from '@/state/hooks';
import Input from '@/elements/Input';
import Select from '@/elements/Select';
import Label from '@/elements/Label';
import { Button } from '@/elements/button';
import { type Mod, type ServerModsConfig } from '@/api/routes/server/mods';
import { searchModpacks, getModpackMinecraftVersions } from '@/api/routes/server/modpacks';
import ModpackDetails from './ModpackDetails';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload, faSearch } from '@fortawesome/free-solid-svg-icons';

const LOADERS = ['forge', 'neoforge', 'fabric', 'quilt'] as const;
const LOADER_LABELS: Record<string, string> = {
    forge: 'Forge',
    neoforge: 'NeoForge',
    fabric: 'Fabric',
    quilt: 'Quilt',
};
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '2', label: 'Popularity' },
    { value: '6', label: 'Total Downloads' },
    { value: '3', label: 'Last Updated' },
    { value: '4', label: 'Name' },
];

const formatDownloads = (n: number): string => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
};

export default function ModpacksContainer({ isSupercharged, detectedConfig: detectedConfigProp }: { isSupercharged: boolean; detectedConfig?: ServerModsConfig | null }) {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const modsEnabled = useStoreState(state => state.everest.data?.mods?.enabled ?? false);

    const detectedConfig = detectedConfigProp ?? null;

    const [loading, setLoading] = useState(false);
    const [modpacks, setModpacks] = useState<Mod[]>([]);
    const [selectedModpack, setSelectedModpack] = useState<Mod | null>(null);
    const [query, setQuery] = useState('');
    const [pendingQuery, setPendingQuery] = useState('');
    const [pagination, setPagination] = useState({ index: 0, pageSize: 20, resultCount: 0, totalCount: 0 });

    // Filters — prefilled from the server egg, overridable by the user.
    const [loader, setLoader] = useState<string>('');
    const [gameVersion, setGameVersion] = useState<string>('latest');
    const [sortField, setSortField] = useState<string>('2');
    const [mcVersions, setMcVersions] = useState<string[]>([]);
    const isInitialLoadRef = useRef(false);

    useEffect(() => {
        getModpackMinecraftVersions(uuid).then(res => setMcVersions(res.data)).catch(() => {});
    }, [uuid]);

    // Prefill loader + version from detected config, then trigger the initial search using
    // the new values directly (not stale state). Set isInitialLoadRef to suppress the
    // duplicate search that the filter-change effect would otherwise fire.
    useEffect(() => {
        if (!detectedConfig) return;
        const newLoader = detectedConfig.detectedLoader?.slug ?? '';
        const newVersion = detectedConfig.detectedVersion ?? 'latest';
        if (newLoader) setLoader(newLoader);
        if (detectedConfig.detectedVersion) setGameVersion(newVersion);
        isInitialLoadRef.current = true;

        if (!modsEnabled) return;
        setLoading(true);
        searchModpacks(uuid, {
            searchFilter: '',
            pageSize: 20,
            index: 0,
            loader: newLoader || undefined,
            gameVersion: newVersion || undefined,
            sortField,
        })
            .then(res => { setModpacks(res.data); setPagination(res.pagination); })
            .catch(() => {})
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detectedConfig]);

    const doSearch = (searchFilter: string, index: number) => {
        if (!modsEnabled) return;
        setLoading(true);
        searchModpacks(uuid, {
            searchFilter,
            pageSize: 20,
            index,
            loader: loader || undefined,
            gameVersion: gameVersion || undefined,
            sortField,
        })
            .then(res => {
                setModpacks(res.data);
                setPagination(res.pagination);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    // Re-run search when user-initiated filter changes occur. Skip the first trigger
    // after initial detection (which is handled above with the correct values).
    useEffect(() => {
        if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
            return;
        }
        if (!detectedConfig) return;
        doSearch(query, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loader, gameVersion, sortField]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setQuery(pendingQuery);
        doSearch(pendingQuery, 0);
    };

    const handlePage = (newIndex: number) => {
        doSearch(query, newIndex);
    };

    const totalPages = Math.ceil(pagination.totalCount / pagination.pageSize);
    const currentPage = Math.floor(pagination.index / pagination.pageSize) + 1;

    if (!isSupercharged) {
        return (
            <div css={tw`rounded-lg bg-black/20 p-8 text-center`}>
                <p css={tw`text-lg font-medium text-neutral-200 mb-2`}>Supercharged Node Required</p>
                <p css={tw`text-sm text-neutral-400`}>
                    Modpack installation uses the script execution API, which is only available on
                    Wings-RS (supercharged) nodes. Contact your administrator to upgrade this node.
                </p>
            </div>
        );
    }

    if (!modsEnabled) {
        return (
            <div css={tw`text-center py-16`}>
                <p css={tw`text-neutral-300 text-lg`}>The Mods module is not enabled.</p>
            </div>
        );
    }

    return (
        <>
            {/* Search bar */}
            <form onSubmit={handleSearch} css={tw`flex gap-2 mb-4`}>
                <div css={tw`relative flex-1`}>
                    <span css={tw`absolute inset-y-0 left-3 flex items-center text-neutral-400 pointer-events-none`}>
                        <FontAwesomeIcon icon={faSearch} css={tw`text-sm`} />
                    </span>
                    <Input
                        type="text"
                        placeholder="Search modpacks…"
                        value={pendingQuery}
                        onChange={e => setPendingQuery(e.target.value)}
                        css={tw`pl-9`}
                    />
                </div>
                <Button type="submit">Search</Button>
            </form>

            {/* Filters */}
            <div css={tw`flex flex-wrap items-end gap-3 mb-6`}>
                <div css={tw`flex flex-col gap-1`}>
                    <Label>Loader</Label>
                    <Select value={loader} onChange={e => setLoader(e.target.value)}>
                        {LOADERS.map(l => (
                            <option key={l} value={l}>
                                {LOADER_LABELS[l]}
                            </option>
                        ))}
                    </Select>
                </div>

                <div css={tw`flex flex-col gap-1`}>
                    <Label>Minecraft Version</Label>
                    <Select value={gameVersion} onChange={e => setGameVersion(e.target.value)}>
                        <option value="latest">Latest</option>
                        <option value="any">Any version</option>
                        {detectedConfig?.detectedVersion &&
                            !mcVersions.includes(detectedConfig.detectedVersion) && (
                                <option value={detectedConfig.detectedVersion}>
                                    {detectedConfig.detectedVersion} (server)
                                </option>
                            )}
                        {mcVersions.map(v => (
                            <option key={v} value={v}>
                                {v}
                            </option>
                        ))}
                    </Select>
                </div>

                <div css={tw`flex flex-col gap-1`}>
                    <Label>Sort by</Label>
                    <Select value={sortField} onChange={e => setSortField(e.target.value)}>
                        {SORT_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>

            {loading && !modpacks.length ? (
                <div css={tw`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="rounded border border-neutral-700 bg-neutral-800 overflow-hidden animate-pulse">
                            <div className="flex items-start gap-3 p-3 border-b border-neutral-700/50">
                                <div className="w-12 h-12 rounded bg-neutral-700 flex-shrink-0" />
                                <div className="flex-1 min-w-0 space-y-2 pt-1">
                                    <div className="h-3.5 bg-neutral-700 rounded w-3/4" />
                                    <div className="h-3 bg-neutral-700 rounded w-1/2" />
                                </div>
                            </div>
                            <div className="flex gap-3 px-3 py-2">
                                <div className="h-3 bg-neutral-700 rounded w-12" />
                                <div className="h-3 bg-neutral-700 rounded w-14" />
                            </div>
                            <div className="px-3 pb-3 space-y-1.5">
                                <div className="h-3 bg-neutral-700 rounded w-full" />
                                <div className="h-3 bg-neutral-700 rounded w-4/5" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : modpacks.length === 0 && !loading ? (
                <div css={tw`text-center py-16`}>
                    <p css={tw`text-neutral-400`}>No modpacks found.</p>
                </div>
            ) : (
                <>
                    <div css={tw`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`}>
                        {modpacks.map(pack => (
                            <button
                                key={pack.id}
                                type="button"
                                onClick={() => setSelectedModpack(pack)}
                                css={tw`text-left rounded border border-neutral-700 bg-neutral-800 hover:border-neutral-600 transition-colors overflow-hidden`}
                            >
                                <div css={tw`flex items-start gap-3 p-3 border-b border-neutral-700/50`}>
                                    {pack.logo?.thumbnailUrl ? (
                                        <img
                                            src={pack.logo.thumbnailUrl}
                                            alt={pack.name}
                                            css={tw`w-12 h-12 rounded flex-shrink-0 bg-neutral-900 object-cover`}
                                        />
                                    ) : (
                                        <div css={tw`w-12 h-12 rounded flex-shrink-0 bg-neutral-700 flex items-center justify-center`}>
                                            <span css={tw`text-neutral-500 text-xl`}>📦</span>
                                        </div>
                                    )}
                                    <div css={tw`flex-1 min-w-0`}>
                                        <p css={tw`text-sm font-semibold text-neutral-100 truncate mb-0.5`}>{pack.name}</p>
                                        <p css={tw`text-xs text-neutral-400 truncate`}>by {pack.authors[0]?.name ?? 'Unknown'}</p>
                                    </div>
                                </div>
                                <div css={tw`flex items-center gap-3 px-3 py-2 text-xs text-neutral-400`}>
                                    <span css={tw`flex items-center gap-1`}>
                                        <FontAwesomeIcon icon={faDownload} />
                                        {formatDownloads(pack.downloadCount)}
                                    </span>
                                    {(pack.categories as unknown as string[])?.slice(0, 2).map(cat => (
                                        <span key={cat} css={tw`bg-neutral-700 px-1.5 py-0.5 rounded capitalize`}>{cat}</span>
                                    ))}
                                </div>
                                <p css={tw`px-3 pb-3 text-xs text-neutral-500 line-clamp-2`}>{pack.summary}</p>
                            </button>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div css={tw`flex items-center justify-center gap-2 mt-6`}>
                            <button
                                css={tw`px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-300 disabled:opacity-40 hover:border-neutral-600 transition-colors`}
                                disabled={currentPage <= 1}
                                onClick={() => handlePage((currentPage - 2) * pagination.pageSize)}
                            >
                                Previous
                            </button>
                            <span css={tw`text-sm text-neutral-400`}>
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                css={tw`px-3 py-1.5 text-sm rounded border border-neutral-700 text-neutral-300 disabled:opacity-40 hover:border-neutral-600 transition-colors`}
                                disabled={currentPage >= totalPages}
                                onClick={() => handlePage(currentPage * pagination.pageSize)}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}

            {selectedModpack && (
                <ModpackDetails
                    key={selectedModpack.id}
                    modpack={selectedModpack}
                    onClose={() => setSelectedModpack(null)}
                    detectedConfig={detectedConfig}
                    filterLoader={loader || undefined}
                    filterGameVersion={gameVersion || undefined}
                />
            )}
        </>
    );
}
