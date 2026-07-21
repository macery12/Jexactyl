import http from '@/api/http';

export interface ModSearchParams {
    searchFilter?: string;
    sortField?: string;
    sortOrder?: string;
    gameVersion?: string;
    modLoaderType?: number;
    pageSize?: number;
    index?: number;
    source?: 'modrinth' | 'spigot';
    categoryId?: number;
    minRating?: number;
    resource?: 'mods' | 'plugins';
    platform?: string | string[];
}

export interface ModFileParams {
    gameVersion?: string;
    modLoaderType?: number;
    pageSize?: number;
    index?: number;
    source?: 'modrinth' | 'spigot';
    resource?: 'mods' | 'plugins';
    platform?: string | string[];
}

export interface ModAuthor {
    id: number;
    name: string;
    url: string;
}

export interface ModFile {
    id: number;
    gameId: number;
    modId: number;
    isAvailable: boolean;
    displayName: string;
    fileName: string;
    releaseType: number;
    fileStatus: number;
    hashes: Array<{ value: string; algo: number }>;
    fileDate: string;
    fileLength: number;
    downloadCount: number;
    downloadUrl: string;
    gameVersions: string[];
    sortableGameVersions: Array<{
        gameVersionName: string;
        gameVersionPadded: string;
        gameVersion: string;
        gameVersionReleaseDate: string;
        gameVersionTypeId: number;
    }>;
    dependencies: Array<{ modId: number; relationType: number }>;
    alternateFileId: number;
    isServerPack: boolean;
    fileFingerprint: number;
    modules: Array<{ name: string; fingerprint: number }>;
}

export interface ModCategory {
    id: number;
    gameId: number;
    name: string;
    slug: string;
    url: string;
    iconUrl: string;
    dateModified: string;
    isClass: boolean;
    classId: number;
    parentCategoryId: number;
}

export interface Mod {
    id: number;
    gameId: number;
    name: string;
    slug: string;
    links: {
        websiteUrl: string;
        wikiUrl: string;
        issuesUrl: string;
        sourceUrl: string;
    };
    summary: string;
    status: number;
    downloadCount: number;
    isFeatured: boolean;
    primaryCategoryId: number;
    categories: ModCategory[];
    classId: number;
    authors: ModAuthor[];
    logo: {
        id: number;
        modId: number;
        title: string;
        description: string;
        thumbnailUrl: string;
        url: string;
    };
    screenshots: Array<{
        id: number;
        modId: number;
        title: string;
        description: string;
        thumbnailUrl: string;
        url: string;
    }>;
    mainFileId: number;
    latestFiles: ModFile[];
    latestFilesIndexes: Array<{
        gameVersion: string;
        fileId: number;
        filename: string;
        releaseType: number;
        gameVersionTypeId: number;
        modLoader: number;
    }>;
    dateCreated: string;
    dateModified: string;
    dateReleased: string;
    allowModDistribution: boolean;
    gamePopularityRank: number;
    rating?: { average?: number; count?: number };
    isPremium?: boolean;
    isExternal?: boolean;
    externalUrl?: string | null;
    testedVersions?: string[];
    description?: string | null;
    documentation?: string | null;
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

export interface ModSearchResponse {
    data: Mod[];
    pagination: {
        index: number;
        pageSize: number;
        resultCount: number;
        totalCount: number;
    };
    filters?: {
        supported?: {
            search?: boolean;
            category?: boolean;
            sort?: string[];
            minRating?: boolean;
            [key: string]: unknown;
        };
        unsupported?: Record<string, string>;
        options?: {
            categories?: Array<{ id: number; name: string }>;
            sortBy?: Array<{ id: string; label: string }>;
            minRating?: Array<{ id: number | null; label: string }>;
        };
    };
    provider?: string;
}

export interface ModResponse {
    data: Mod;
}

export interface ModFilesResponse {
    data: ModFile[];
    pagination: {
        index: number;
        pageSize: number;
        resultCount: number;
        totalCount: number;
    };
}

export interface ProviderAccessResponse {
    providers: Record<string, { allowed: boolean }>;
}

export const getProviderAccess = (uuid: string): Promise<ProviderAccessResponse> =>
    http.get(`/api/client/servers/${uuid}/mods/providers`).then(r => r.data);

export interface ServerModsConfig {
    detectedVersion: string | null;
    detectedLoader: { id: number; name: string; slug: string } | null;
    detectedPlatform: string | null;
}

export const getServerModsConfig = (uuid: string): Promise<ServerModsConfig> =>
    http.get(`/api/client/servers/${uuid}/mods/server-config`).then(r => r.data);

export interface MinecraftVersion {
    id: number;
    gameVersionId: number;
    versionString: string;
    jarDownloadUrl: string;
    jsonDownloadUrl: string;
    approved: boolean;
    dateModified: string;
    gameVersionTypeId: number;
    gameVersionStatus: number;
    gameVersionTypeStatus: number;
}

export interface ModLoaderType {
    id: number;
    gameVersionTypeId: number;
    name: string;
    slug: string;
}

export const searchMods = (uuid: string, params: ModSearchParams): Promise<ModSearchResponse> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/mods/search`, { params })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getMod = (
    uuid: string,
    modId: number | string,
    source?: string,
    resource?: 'mods' | 'plugins',
): Promise<ModResponse> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/mods/${modId}`, { params: { source, resource } })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getModFiles = (uuid: string, modId: number | string, params: ModFileParams): Promise<ModFilesResponse> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/mods/${modId}/files`, { params })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export interface DownloadQueueResponse {
    queued: boolean;
    queue_id: string;
    position: number;
}

export interface DownloadQueueItem {
    uuid: string;
    provider: string;
    source: string;
    project_id: string;
    file_id: string;
    file_name: string | null;
    error_message: string | null;
    // Captured install-script output for modpack parent items (for the log modal).
    install_log: string | null;
    // Modpack install progress (mods). phase encodes the step, e.g. "mods:2/4".
    total_children: number | null;
    completed_children: number | null;
    failed_children: number | null;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    phase: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
}

export const downloadMod = (
    uuid: string,
    modId: number | string,
    fileId: number | string,
    source?: string,
    resource?: 'mods' | 'plugins',
): Promise<DownloadQueueResponse> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/servers/${uuid}/mods/${modId}/files/${fileId}/download`, { source, resource })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getDownloadQueue = (uuid: string): Promise<{ data: DownloadQueueItem[] }> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/mods/queue`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const cancelQueueItem = (uuid: string, queueId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.delete(`/api/client/servers/${uuid}/mods/queue/${queueId}`)
            .then(() => resolve())
            .catch(reject);
    });
};

export const retryQueueItem = (uuid: string, queueId: string): Promise<DownloadQueueResponse> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/servers/${uuid}/mods/queue/${queueId}/retry`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export interface BulkClearResponse {
    deleted: number;
}

export interface BulkClearActiveWarning {
    error: string;
    active_count: number;
    active_uuids: string[];
}

export const bulkClearQueue = (uuid: string, uuids?: string[], force = false): Promise<BulkClearResponse> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/servers/${uuid}/mods/queue/bulk-clear`, { uuids: uuids ?? null, force })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getMinecraftVersions = (
    uuid: string,
    source?: string,
    resource?: 'mods' | 'plugins',
): Promise<{ data: MinecraftVersion[] }> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/mods/minecraft/versions`, { params: { source, resource } })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getModLoaderTypes = (
    uuid: string,
    source?: string,
    resource?: 'mods' | 'plugins',
): Promise<{ data: ModLoaderType[] }> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/servers/${uuid}/mods/minecraft/loaders`, { params: { source, resource } })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};
