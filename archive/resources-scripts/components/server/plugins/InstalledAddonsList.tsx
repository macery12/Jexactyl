import { useCallback, useEffect, useState } from 'react';
import { differenceInHours, format, formatDistanceToNow } from 'date-fns';
import {
    InstalledAddon,
    InstalledContentType,
    InstalledStatusFilter,
    getInstalledAddons,
    toggleInstalledAddon,
} from '@/api/routes/server/plugins';
import Spinner from '@/elements/Spinner';
import tw from 'twin.macro';
import { bytesToString } from '@/lib/formatters';
import Input from '@/elements/Input';
import Pagination from '@/elements/Pagination';
import { Button } from '@/elements/button';
import useFlash, { useFlashKey } from '@/plugins/useFlash';
import { useStoreState } from '@/state/hooks';
import { httpErrorToHuman, PaginatedResult } from '@/api/http';

interface Props {
    serverUuid?: string | null;
}

const useThemeColors = () => useStoreState(state => state.theme.data!.colors);

const badgeStyle = (enabled: boolean) =>
    enabled ? tw`bg-green-500/20 text-green-200` : tw`bg-yellow-500/20 text-yellow-200`;

const formatModified = (modifiedAt: Date | null): string => {
    if (!modifiedAt) return 'Unknown';

    const hourDelta = differenceInHours(new Date(), modifiedAt);
    const farApart = Math.abs(hourDelta) > 48;

    return farApart ? format(modifiedAt, 'MMM do, yyyy h:mm a') : formatDistanceToNow(modifiedAt, { addSuffix: true });
};

const ITEMS_PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 250;

const InstalledAddonsList = ({ serverUuid }: Props) => {
    const { clearFlashes } = useFlash();
    const { addError } = useFlashKey('plugins');
    const colors = useThemeColors();
    const [activeType, setActiveType] = useState<InstalledContentType>('mods');
    const [status, setStatus] = useState<InstalledStatusFilter>('all');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [togglingPath, setTogglingPath] = useState<string | null>(null);
    const [data, setData] = useState<PaginatedResult<InstalledAddon> | null>(null);

    const fetchInstalled = useCallback(
        () =>
            getInstalledAddons(serverUuid!, {
                type: activeType,
                status,
                search: debouncedSearch,
                page,
                perPage: ITEMS_PER_PAGE,
            }),
        [serverUuid, activeType, status, debouncedSearch, page],
    );

    // Keep search debounced to avoid excessive calls.
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [search]);

    useEffect(() => {
        setPage(1);
    }, [activeType, status, debouncedSearch]);

    useEffect(() => {
        if (!serverUuid) return;

        setLoading(true);
        clearFlashes('plugins');
        fetchInstalled()
            .then(setData)
            .catch(error => {
                console.error(error);
                addError(httpErrorToHuman(error));
            })
            .finally(() => setLoading(false));
    }, [serverUuid, fetchInstalled]);

    const handleToggle = async (item: InstalledAddon) => {
        if (!serverUuid) return;
        setTogglingPath(item.path);
        try {
            await toggleInstalledAddon(serverUuid, { type: activeType, path: item.path, enable: !item.enabled });
            // Refresh list after successful toggle to reflect the server state.
            setLoading(true);
            const refreshed = await fetchInstalled();
            setData(refreshed);
        } catch (error) {
            console.error(error);
            addError(httpErrorToHuman(error));
        } finally {
            setTogglingPath(null);
            setLoading(false);
        }
    };

    const filters = (
        <div css={tw`flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`}>
            <div css={tw`flex items-center gap-3`}>
                {(['mods', 'plugins'] as InstalledContentType[]).map(type => {
                    const active = activeType === type;
                    return (
                        <button
                            key={type}
                            css={[
                                tw`px-4 py-2 rounded-md text-sm font-semibold transition-colors`,
                                !active && tw`bg-neutral-800 text-neutral-200 hover:bg-neutral-700`,
                            ]}
                            style={active ? { backgroundColor: colors.primary, color: '#fff' } : undefined}
                            onClick={() => setActiveType(type)}
                            type="button"
                        >
                            {type === 'mods' ? 'Mods' : 'Plugins'}
                        </button>
                    );
                })}
            </div>

            <div css={tw`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4`}>
                <div css={tw`flex items-center gap-2`}>
                    {(['all', 'enabled', 'disabled'] as InstalledStatusFilter[]).map(filter => {
                        const active = status === filter;
                        const labelMap: Record<InstalledStatusFilter, string> = {
                            all: 'All',
                            enabled: 'Enabled',
                            disabled: 'Disabled',
                        };
                        return (
                            <button
                                key={filter}
                                css={[
                                    tw`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors`,
                                    !active && tw`bg-neutral-800 text-neutral-300 hover:bg-neutral-700`,
                                ]}
                                style={active ? { backgroundColor: colors.primary, color: '#fff' } : undefined}
                                onClick={() => setStatus(filter)}
                                type="button"
                            >
                                {labelMap[filter]}
                            </button>
                        );
                    })}
                </div>

                <div css={tw`w-full sm:w-72`}>
                    <Input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={'Search by name or filename'}
                    />
                </div>
            </div>
        </div>
    );

    const renderItem = (item: InstalledAddon) => (
        <div
            key={item.path}
            css={tw`rounded border border-neutral-700 px-3 py-3 sm:px-4 flex flex-col gap-2`}
            style={{ backgroundColor: colors.secondary }}
        >
            <div css={tw`flex items-start gap-3`}>
                <div css={tw`flex-1 min-w-0`}>
                    <div css={tw`text-base sm:text-lg font-semibold text-neutral-100 truncate`}>
                        {item.friendlyName || item.filename}
                    </div>
                    <div css={tw`font-mono text-xs text-neutral-400 truncate`}>{item.filename}</div>
                </div>
            </div>
            <div css={tw`flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm text-neutral-200`}>
                <span css={[tw`px-2 py-1 rounded-full text-xs font-semibold`, badgeStyle(item.enabled)]}>
                    {item.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <span css={tw`text-neutral-300 whitespace-nowrap`}>{bytesToString(item.sizeBytes)}</span>
                <span
                    css={tw`text-neutral-400 whitespace-nowrap`}
                    title={item.modifiedAt ? format(item.modifiedAt, 'PPpp') : undefined}
                >
                    {formatModified(item.modifiedAt)}
                </span>
                {item.enabled ? (
                    <Button.Danger
                        size={Button.Sizes.Small}
                        onClick={() => handleToggle(item)}
                        disabled={togglingPath === item.path || loading}
                        loading={togglingPath === item.path}
                        css={tw`ml-auto flex-none`}
                    >
                        Disable
                    </Button.Danger>
                ) : (
                    <Button.Success
                        size={Button.Sizes.Small}
                        onClick={() => handleToggle(item)}
                        disabled={togglingPath === item.path || loading}
                        loading={togglingPath === item.path}
                        css={tw`ml-auto flex-none`}
                    >
                        Enable
                    </Button.Success>
                )}
            </div>
        </div>
    );

    const renderEmpty = () => (
        <div css={tw`text-center text-sm text-neutral-400 border border-dashed border-neutral-700 rounded p-6`}>
            {activeType === 'mods' ? 'No mods found.' : 'No plugins found.'}
        </div>
    );

    if (!serverUuid) {
        return <Spinner size={'large'} centered />;
    }

    return (
        <div css={tw`space-y-4`}>
            {filters}
            {loading && !data ? (
                <Spinner size={'large'} centered />
            ) : !data ? (
                renderEmpty()
            ) : (
                <Pagination data={data} onPageSelect={setPage}>
                    {({ items }) =>
                        !items.length ? (
                            renderEmpty()
                        ) : (
                            <div css={tw`grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4`}>{items.map(renderItem)}</div>
                        )
                    }
                </Pagination>
            )}
        </div>
    );
};

export default InstalledAddonsList;
