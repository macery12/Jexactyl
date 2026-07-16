import http from '@/lib/http';

// Server-scoped mods & plugins client. Talks to the same Laravel client API the
// V1 marketplace used (/api/client/servers/{server}/mods|plugins). The path
// param is the server *identifier* (route :id), matching serverResources.ts.
// Field shapes mirror the CurseForge-normalised payload the backend returns, so
// they stay in the API layer's snake/camel form rather than being remapped.

export type Source = 'modrinth' | 'spigot';
export type Resource = 'mods' | 'plugins';

export interface ModSearchParams {
    searchFilter?: string;
    sortField?: string;
    sortOrder?: string;
    gameVersion?: string;
    modLoaderType?: number;
    pageSize?: number;
    index?: number;
    source?: Source;
    categoryId?: number;
    minRating?: number;
    resource?: Resource;
    platform?: string | string[];
}

export interface ModAuthor {
    id: number;
    name: string;
    url: string;
}

export interface ModFile {
    id: number;
    modId: number;
    isAvailable: boolean;
    displayName: string;
    fileName: string;
    releaseType: number;
    fileDate: string;
    fileLength: number;
    downloadCount: number;
    downloadUrl: string;
    gameVersions: string[];
    dependencies: Array<{ modId: number; relationType: number }>;
}

export interface ModCategory {
    id: number;
    name: string;
    slug: string;
    url: string;
    iconUrl: string;
}

export interface Mod {
    id: number;
    name: string;
    slug: string;
    links?: {
        websiteUrl?: string;
        wikiUrl?: string;
        issuesUrl?: string;
        sourceUrl?: string;
    };
    summary: string;
    downloadCount: number;
    isFeatured: boolean;
    categories: ModCategory[];
    classId?: number;
    authors: ModAuthor[];
    logo?: {
        id: number;
        thumbnailUrl: string;
        url: string;
    } | null;
    latestFiles: ModFile[];
    dateCreated?: string;
    dateModified?: string;
    dateReleased?: string;
    rating?: { average?: number; count?: number };
    isExternal?: boolean;
    externalUrl?: string | null;
    description?: string | null;
    latestVersion?: {
        id?: number | string;
        name?: string;
        releaseDate?: string;
        downloads?: number;
        rating?: { average?: number; count?: number };
    } | null;
    file?: {
        type?: string | null;
        size?: number | null;
        sizeUnit?: string | null;
        url?: string | null;
        externalUrl?: string | null;
    } | null;
}

export interface ModPagination {
    index: number;
    pageSize: number;
    resultCount: number;
    totalCount: number;
}

export interface ModFilterOptions {
    categories?: Array<{ id: number; name: string }>;
    sortBy?: Array<{ id: string; label: string }>;
    minRating?: Array<{ id: number | null; label: string }>;
}

export interface ModSearchResponse {
    data: Mod[];
    pagination: ModPagination;
    filters?: {
        supported?: {
            search?: boolean;
            category?: boolean;
            sort?: string[];
            minRating?: boolean;
            [key: string]: unknown;
        };
        unsupported?: Record<string, string>;
        options?: ModFilterOptions;
    };
    provider?: string;
}

export interface ServerModsConfig {
    detectedVersion: string | null;
    detectedLoader: { id: number; name: string; slug: string } | null;
    detectedPlatform: string | null;
}

export interface MinecraftVersion {
    id: number;
    versionString: string;
    gameVersionTypeId: number;
}

export interface ModLoaderType {
    id: number;
    name: string;
    slug: string;
}

// --- Search ------------------------------------------------------------------

// Coerce a value to a finite integer, or drop it (undefined). The backend's
// `integer` validation rejects "NaN"/floats/empty strings, so paginated params
// must always serialize as clean integers.
const toInt = (v: unknown): number | undefined => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : undefined;
};

export const searchMods = (server: string, params: ModSearchParams): Promise<ModSearchResponse> => {
    const safe: ModSearchParams = {
        ...params,
        index: toInt(params.index) ?? 0,
        pageSize: toInt(params.pageSize) ?? 24,
        modLoaderType: toInt(params.modLoaderType),
        categoryId: toInt(params.categoryId),
    };
    return http.get(`/api/client/servers/${server}/mods/search`, { params: safe }).then(r => r.data);
};

// Page shape consumed by useInfiniteQuery. `nextIndex` is undefined once the
// last page has been reached (drives getNextPageParam).
export interface ModSearchPage extends ModSearchResponse {
    nextIndex?: number;
}

export const searchModsPage = async (server: string, params: ModSearchParams): Promise<ModSearchPage> => {
    const res = await searchMods(server, params);
    // Page off the count we actually received rather than the provider-reported
    // pageSize/totalCount (Spiget returns a synthetic total). A full page means
    // there may be more; a short page ends pagination.
    const requested = toInt(params.pageSize) ?? 24;
    const index = toInt(res.pagination?.index) ?? toInt(params.index) ?? 0;
    const resultCount = toInt(res.pagination?.resultCount) ?? res.data?.length ?? 0;
    const hasMore = resultCount > 0 && resultCount >= requested;
    return { ...res, nextIndex: hasMore ? index + resultCount : undefined };
};

// --- Details -----------------------------------------------------------------

export const getMod = (
    server: string,
    modId: number | string,
    source?: string,
    resource?: Resource,
): Promise<{ data: Mod }> =>
    http.get(`/api/client/servers/${server}/mods/${modId}`, { params: { source, resource } }).then(r => r.data);

export interface ModFileParams {
    gameVersion?: string;
    modLoaderType?: number;
    pageSize?: number;
    index?: number;
    source?: Source;
    resource?: Resource;
    platform?: string | string[];
}

export const getModFiles = (
    server: string,
    modId: number | string,
    params: ModFileParams,
): Promise<{ data: ModFile[]; pagination: ModPagination }> =>
    http.get(`/api/client/servers/${server}/mods/${modId}/files`, { params }).then(r => r.data);

export interface DownloadQueueResponse {
    queued: boolean;
    queue_id: string;
    position: number;
}

export const downloadModFile = (
    server: string,
    modId: number | string,
    fileId: number | string,
    source?: string,
    resource?: Resource,
): Promise<DownloadQueueResponse> =>
    http
        .post(`/api/client/servers/${server}/mods/${modId}/files/${fileId}/download`, { source, resource })
        .then(r => r.data);

// --- Filter metadata ---------------------------------------------------------

export const getMinecraftVersions = (
    server: string,
    source?: string,
    resource?: Resource,
): Promise<{ data: MinecraftVersion[] }> =>
    http
        .get(`/api/client/servers/${server}/mods/minecraft/versions`, { params: { source, resource } })
        .then(r => r.data);

export const getModLoaderTypes = (
    server: string,
    source?: string,
    resource?: Resource,
): Promise<{ data: ModLoaderType[] }> =>
    http
        .get(`/api/client/servers/${server}/mods/minecraft/loaders`, { params: { source, resource } })
        .then(r => r.data);

export const getServerModsConfig = (server: string): Promise<ServerModsConfig> =>
    http.get(`/api/client/servers/${server}/mods/server-config`).then(r => r.data);

// --- Providers & installed addons -------------------------------------------

export type ProviderKey = 'modrinth' | 'spigot';

export interface PluginCapabilityResponse {
    mods: ProviderKey[];
    plugins: ProviderKey[];
}

export const getPluginCapabilities = (server: string): Promise<PluginCapabilityResponse> =>
    http.get(`/api/client/servers/${server}/plugins/capabilities`).then(r => r.data);

export type InstalledAddonType = 'mod' | 'plugin';
export type InstalledContentType = 'mods' | 'plugins';
export type InstalledStatusFilter = 'all' | 'enabled' | 'disabled';

export interface InstalledAddon {
    filename: string;
    friendlyName: string;
    path: string;
    sizeBytes: number;
    modifiedAt: string | null;
    type: InstalledAddonType;
    enabled: boolean;
}

interface RawInstalledAddon {
    filename?: string;
    name?: string;
    friendly_name?: string;
    display_name?: string;
    path?: string;
    size_bytes?: number;
    size?: number;
    modified_at?: string;
    type?: InstalledAddonType;
    enabled?: boolean;
    disabled?: boolean;
}

const toInstalledAddon = (raw: RawInstalledAddon): InstalledAddon => ({
    filename: raw.filename ?? raw.name ?? '',
    friendlyName: raw.friendly_name ?? raw.display_name ?? raw.name ?? '',
    path: raw.path ?? '',
    sizeBytes: Number(raw.size_bytes ?? raw.size ?? 0),
    modifiedAt: raw.modified_at ?? null,
    type: (raw.type ?? 'mod') as InstalledAddonType,
    enabled:
        typeof raw.enabled === 'boolean' ? raw.enabled : typeof raw.disabled === 'boolean' ? !raw.disabled : false,
});

export interface InstalledAddonQuery {
    type: InstalledContentType;
    page?: number;
    perPage?: number;
    search?: string;
    status?: InstalledStatusFilter;
}

export interface InstalledAddonPage {
    items: InstalledAddon[];
    pagination: { total: number; count: number; perPage: number; currentPage: number; totalPages: number };
}

export const getInstalledAddons = (server: string, query: InstalledAddonQuery): Promise<InstalledAddonPage> =>
    http
        .get(`/api/client/servers/${server}/plugins/installed`, {
            params: {
                type: query.type,
                page: query.page ?? 1,
                perPage: query.perPage ?? 50,
                search: query.search || undefined,
                status: query.status ?? 'all',
            },
        })
        .then(r => ({
            items: (r.data?.items ?? []).map(toInstalledAddon),
            pagination: {
                total: r.data?.pagination?.total ?? 0,
                count: r.data?.pagination?.count ?? 0,
                perPage: r.data?.pagination?.per_page ?? query.perPage ?? 50,
                currentPage: r.data?.pagination?.current_page ?? query.page ?? 1,
                totalPages: r.data?.pagination?.total_pages ?? 1,
            },
        }));

export const toggleInstalledAddon = (
    server: string,
    payload: { type: InstalledContentType; path: string; enable: boolean },
): Promise<InstalledAddon> =>
    http
        .post(`/api/client/servers/${server}/plugins/installed/toggle`, payload)
        .then(r => toInstalledAddon(r.data?.item ?? {}));
