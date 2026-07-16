import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import { useStoreState } from '@/state/hooks';
import Input from '@/elements/Input';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import { Button } from '@/elements/button';
import { type ModSearchParams, type ServerModsConfig, getMinecraftVersions } from '@/api/routes/server/mods';
import { httpErrorToHuman } from '@/api/http';
import useFlash from '@/plugins/useFlash';

const PLACEHOLDER_VERSIONS = new Set(['latest', 'recommended', 'stable', 'release', 'current', 'snapshot', '0', '0.0', '0.0.0']);
const isVersionPlaceholder = (v: string) => !!v && PLACEHOLDER_VERSIONS.has(v.toLowerCase().trim());

const LOADER_OPTIONS = [
    { value: '', label: 'All Loaders' },
    { value: '1', label: 'Forge' },
    { value: '4', label: 'Fabric' },
    { value: '5', label: 'Quilt' },
    { value: '6', label: 'NeoForge' },
];

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
    paper: 'Paper',
    spigot: 'Spigot',
    bukkit: 'Bukkit',
    folia: 'Folia',
    purpur: 'Purpur',
    velocity: 'Velocity',
    waterfall: 'Waterfall',
    bungeecord: 'BungeeCord',
    sponge: 'Sponge',
};

interface Props {
    onSearch: (params: ModSearchParams) => void;
    initialParams: ModSearchParams;
    source: string;
    contentType?: 'mods' | 'plugins';
    filtersMeta?: {
        options?: {
            categories?: Array<{ id: number; name: string }>;
            sortBy?: Array<{ id: string; label: string }>;
            minRating?: Array<{ id: number | null; label: string }>;
            platforms?: Array<{ id: string; name: string }>;
        };
        unsupported?: Record<string, string>;
    };
    detectedConfig?: ServerModsConfig | null;
    onShowAll?: () => void;
}

const DEFAULT_SORT_OPTIONS = [
    { value: '1', label: 'Featured' },
    { value: '2', label: 'Popularity' },
    { value: '3', label: 'Last Updated' },
    { value: '4', label: 'Name' },
    { value: '5', label: 'Author' },
    { value: '6', label: 'Total Downloads' },
];

export default ({ onSearch, initialParams, source, contentType = 'mods', filtersMeta, detectedConfig, onShowAll }: Props) => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { colors } = useStoreState(state => state.theme.data!);
    const { addError } = useFlash();

    const [searchFilter, setSearchFilter] = useState(initialParams.searchFilter || '');
    const [sortField, setSortField] = useState(initialParams.sortField || (source === 'spigot' ? 'downloads' : '2'));
    const [gameVersion, setGameVersion] = useState(initialParams.gameVersion || '');
    const [modLoaderType, setModLoaderType] = useState<string>(initialParams.modLoaderType?.toString() || '');
    const [categoryId, setCategoryId] = useState<string>('');
    const [minRating, setMinRating] = useState<string>(initialParams.minRating?.toString() ?? '');
    const [platform, setPlatform] = useState<string>(
        Array.isArray(initialParams.platform) ? (initialParams.platform[0] ?? '') : (initialParams.platform ?? ''),
    );

    // Sync all filter state from parent whenever the parent's params change (e.g. detected config applied)
    useEffect(() => {
        setGameVersion(initialParams.gameVersion || '');
        setModLoaderType(initialParams.modLoaderType?.toString() || '');
        const rawPlatform = Array.isArray(initialParams.platform)
            ? (initialParams.platform[0] ?? '')
            : (initialParams.platform ?? '');
        setPlatform(rawPlatform);
    }, [initialParams.gameVersion, initialParams.modLoaderType, initialParams.platform]);

    const [minecraftVersions, setMinecraftVersions] = useState<string[]>([]);

    useEffect(() => {
        if (source === 'spigot') {
            setMinecraftVersions([]);
            return;
        }

        getMinecraftVersions(uuid, source, contentType)
            .then(response => {
                const versions = response.data
                    .filter(v => v.versionString && v.gameVersionTypeId === 1)
                    .map(v => v.versionString)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .sort((a, b) => {
                        const aParts = a.split('.').map(Number);
                        const bParts = b.split('.').map(Number);
                        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                            const aNum = aParts[i] || 0;
                            const bNum = bParts[i] || 0;
                            if (aNum !== bNum) return bNum - aNum;
                        }
                        return 0;
                    });
                setMinecraftVersions(versions);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'mods', message: httpErrorToHuman(error) });
            });
    }, [uuid, source, contentType]);

    // When versions load or gameVersion becomes a placeholder, resolve to the highest real version
    useEffect(() => {
        if (source === 'spigot' || minecraftVersions.length === 0) return;
        if (!gameVersion || !isVersionPlaceholder(gameVersion)) return;

        const resolved = minecraftVersions[0];
        if (!resolved) return;
        setGameVersion(resolved);
        onSearch({
            searchFilter: searchFilter || undefined,
            sortField,
            sortOrder: 'desc',
            gameVersion: resolved,
            modLoaderType: modLoaderType ? parseInt(modLoaderType, 10) : undefined,
            platform: platform || undefined,
            resource: contentType,
            pageSize: 20,
            index: 0,
        });
    }, [minecraftVersions, gameVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (source !== 'spigot') return;
        const timer = setTimeout(() => {
            onSearch({
                searchFilter: searchFilter || undefined,
                sortField,
                sortOrder: 'desc',
                pageSize: 20,
                index: 0,
                categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
                minRating: minRating ? parseFloat(minRating) : undefined,
                resource: contentType,
            });
        }, 400);

        return () => clearTimeout(timer);
    }, [searchFilter, sortField, categoryId, minRating, source, contentType]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSearch({
            searchFilter: searchFilter || undefined,
            sortField,
            sortOrder: 'desc',
            gameVersion: source === 'spigot' ? undefined : gameVersion || undefined,
            modLoaderType: source === 'spigot' ? undefined : modLoaderType ? parseInt(modLoaderType, 10) : undefined,
            categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
            minRating: source === 'spigot' && minRating ? parseFloat(minRating) : undefined,
            platform: platform || undefined,
            resource: contentType,
            pageSize: 20,
            index: 0,
        });
    };

    const handleClear = () => {
        const detectedVersion = source !== 'spigot' ? (detectedConfig?.detectedVersion ?? '') : '';
        const detectedLoader = source !== 'spigot' ? (detectedConfig?.detectedLoader?.id?.toString() ?? '') : '';
        const detectedPlatformValue = (source !== 'spigot' && contentType === 'plugins')
            ? (detectedConfig?.detectedPlatform ?? '')
            : '';
        setSearchFilter('');
        setSortField(source === 'spigot' ? 'downloads' : '2');
        setGameVersion(detectedVersion);
        setModLoaderType(detectedLoader);
        setCategoryId('');
        setMinRating('');
        setPlatform(detectedPlatformValue);
        onSearch({
            sortField: source === 'spigot' ? 'downloads' : '2',
            sortOrder: 'desc',
            gameVersion: detectedVersion || undefined,
            modLoaderType: detectedLoader ? parseInt(detectedLoader, 10) : undefined,
            platform: detectedPlatformValue || undefined,
            resource: contentType,
            pageSize: 20,
            index: 0,
        });
    };

    const sortOptions = filtersMeta?.options?.sortBy?.length
        ? filtersMeta.options.sortBy.map(option => ({ value: option.id, label: option.label }))
        : DEFAULT_SORT_OPTIONS;

    const categories = filtersMeta?.options?.categories || [];
    const minRatingOptions =
        source === 'spigot' && filtersMeta?.options?.minRating?.length
            ? filtersMeta.options.minRating
            : [
                  { id: null, label: 'Any Rating' },
                  { id: 4.5, label: '4.5+' },
                  { id: 4.0, label: '4.0+' },
                  { id: 3.5, label: '3.5+' },
                  { id: 3.0, label: '3.0+' },
              ];

    const isPluginServer = !!detectedConfig?.detectedPlatform;
    const showMinecraftVersion = source !== 'spigot';
    const showModLoaderFilter = showMinecraftVersion && !isPluginServer && contentType !== 'plugins';
    const showPlatformFilter = contentType === 'plugins' && source === 'modrinth';
    const platformOptions = filtersMeta?.options?.platforms?.map(option => ({
        value: option.id,
        label: option.name,
    })) ?? [
        { value: 'paper', label: 'Paper' },
        { value: 'purpur', label: 'Purpur' },
        { value: 'spigot', label: 'Spigot' },
        { value: 'bukkit', label: 'Bukkit' },
        { value: 'folia', label: 'Folia' },
        { value: 'velocity', label: 'Velocity' },
        { value: 'waterfall', label: 'Waterfall' },
        { value: 'sponge', label: 'Sponge' },
        { value: 'bungeecord', label: 'BungeeCord' },
    ];
    const searchPlaceholder = contentType === 'plugins' ? 'Search plugins...' : 'Search mods...';

    const detectedSoftwareLabel =
        detectedConfig?.detectedLoader?.name ??
        (detectedConfig?.detectedPlatform ? (PLATFORM_DISPLAY_NAMES[detectedConfig.detectedPlatform] ?? detectedConfig.detectedPlatform) : null);

    const isFilteringByDetected =
        source !== 'spigot' &&
        detectedConfig &&
        (detectedConfig.detectedVersion || detectedConfig.detectedLoader || detectedConfig.detectedPlatform);

    const detectedLabel = [detectedConfig?.detectedVersion, detectedSoftwareLabel].filter(Boolean).join(' • ');

    return (
        <form onSubmit={handleSubmit}>
            {isFilteringByDetected && (
                <div css={tw`flex items-center gap-3 mb-4 px-3 py-2 rounded text-sm border border-neutral-700`} style={{ backgroundColor: colors.secondary }}>
                    <span css={tw`text-neutral-400`}>Detected:</span>
                    <span css={tw`text-neutral-200 font-medium`}>{detectedLabel}</span>
                    <span css={tw`text-neutral-500 text-xs`}>— filters pre-applied</span>
                    <button
                        type={'button'}
                        css={tw`ml-auto text-xs text-neutral-400 hover:text-neutral-200 underline transition-colors`}
                        onClick={() => {
                            setGameVersion('');
                            setModLoaderType('');
                            setPlatform('');
                            if (onShowAll) onShowAll();
                        }}
                    >
                        Show all
                    </button>
                </div>
            )}
            <div css={tw`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6`}>
                <div>
                    <Label>Search</Label>
                    <Input
                        type={'text'}
                        placeholder={searchPlaceholder}
                        value={searchFilter}
                        onChange={e => setSearchFilter(e.target.value)}
                    />
                </div>

                {showMinecraftVersion ? (
                    <div>
                        <Label>Minecraft Version</Label>
                        <Select value={gameVersion} onChange={e => setGameVersion(e.target.value)}>
                            <option value="">All Versions</option>
                            {minecraftVersions.map(version => (
                                <option key={version} value={version}>
                                    {version}
                                </option>
                            ))}
                        </Select>
                    </div>
                ) : (
                    <div>
                        <Label>Minimum Rating</Label>
                        <Select value={minRating} onChange={e => setMinRating(e.target.value)}>
                            {minRatingOptions.map(option => (
                                <option key={option.label} value={option.id ?? ''}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}

                {showModLoaderFilter && (
                    <div>
                        <Label>Mod Loader</Label>
                        <Select value={modLoaderType} onChange={e => setModLoaderType(e.target.value)}>
                            {LOADER_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}

                {showPlatformFilter && (
                    <div>
                        <Label>Platform</Label>
                        <Select value={platform} onChange={e => setPlatform(e.target.value)}>
                            <option value="">Any Platform</option>
                            {platformOptions.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}

                <div>
                    <Label>Sort By</Label>
                    <Select value={sortField} onChange={e => setSortField(e.target.value)}>
                        {sortOptions.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </div>

                {source === 'spigot' && (
                    <div>
                        <Label>Category</Label>
                        <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                            <option value="">All Categories</option>
                            {categories.map(category => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
            </div>

            <div css={tw`flex gap-2`}>
                <Button type={'submit'}>Search</Button>
                <Button.Text type={'button'} onClick={handleClear}>
                    Clear Filters
                </Button.Text>
            </div>
        </form>
    );
};
