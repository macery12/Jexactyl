import http from '@/lib/http';
import type { Mod, ModSearchResponse, ModSearchPage } from '@/api/mods';

// CurseForge modpack browsing + install client. Modpacks are gated behind an
// admin-configured CurseForge API key; when it is absent the backend returns an
// empty capability and the user-facing tab is hidden.

export interface ModpackVersion {
    id: number;
    name: string;
    file_name: string;
    release_type: 'release' | 'beta' | 'alpha';
    game_versions: string[];
    loaders: string[];
    date_published: string;
    download_url: string | null;
    file_length: number;
}

export interface ModpackPreview {
    modpack_name: string;
    modpack_version: string;
    minecraft_version: string | null;
    loader: string | null;
    loader_version: string | null;
    server_loader: string | null;
    server_version: string | null;
    loader_mismatch: boolean;
    version_mismatch: boolean;
    required_version: string | null;
    required_loader: string | null;
    required_loader_version: string | null;
}

export interface InstallModpackPayload {
    project_id: number;
    file_id: number;
    modpack_name: string;
    wipe_server: boolean;
    install_loader: boolean;
}

export interface ModpackLoaderStatus {
    has_loader: boolean;
    detected: 'forge' | 'neoforge' | 'fabric' | 'quilt' | null;
}

export interface ModpackSearchParams {
    searchFilter?: string;
    sortField?: string;
    gameVersion?: string; // 'latest' | 'any' | specific MC version
    loader?: string; // forge | neoforge | fabric | quilt
    pageSize?: number;
    index?: number;
}

const toInt = (v: unknown): number | undefined => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : undefined;
};

export const searchModpacks = (server: string, params: ModpackSearchParams): Promise<ModSearchResponse> => {
    const safe: ModpackSearchParams = {
        ...params,
        index: toInt(params.index) ?? 0,
        pageSize: toInt(params.pageSize) ?? 24,
    };
    return http.get(`/api/client/servers/${server}/mods/modpacks/search`, { params: safe }).then(r => r.data);
};

// Infinite-query page shape (mirrors searchModsPage in mods.ts).
export const searchModpacksPage = async (server: string, params: ModpackSearchParams): Promise<ModSearchPage> => {
    const res = await searchModpacks(server, params);
    const requested = toInt(params.pageSize) ?? 24;
    const index = toInt(res.pagination?.index) ?? toInt(params.index) ?? 0;
    const resultCount = toInt(res.pagination?.resultCount) ?? res.data?.length ?? 0;
    const hasMore = resultCount > 0 && resultCount >= requested;
    return { ...res, nextIndex: hasMore ? index + resultCount : undefined };
};

export const getModpack = (server: string, projectId: number): Promise<{ data: Mod }> =>
    http.get(`/api/client/servers/${server}/mods/modpacks/${projectId}`).then(r => r.data);

export const getModpackVersions = (
    server: string,
    projectId: number,
    gameVersion?: string,
    loader?: string,
): Promise<{ data: ModpackVersion[] }> =>
    http
        .get(`/api/client/servers/${server}/mods/modpacks/${projectId}/versions`, { params: { gameVersion, loader } })
        .then(r => r.data);

export const getModpackMinecraftVersions = (server: string): Promise<{ data: string[] }> =>
    http.get(`/api/client/servers/${server}/mods/modpacks/minecraft-versions`).then(r => r.data);

export const getModpackLoaderStatus = (server: string): Promise<ModpackLoaderStatus> =>
    http.get(`/api/client/servers/${server}/mods/modpacks/loader-status`).then(r => r.data);

export const previewModpackInstall = (server: string, projectId: number, fileId: number): Promise<ModpackPreview> =>
    http.post(`/api/client/servers/${server}/mods/modpacks/${projectId}/versions/${fileId}/preview`).then(r => r.data);

export const installModpack = (
    server: string,
    projectId: number,
    fileId: number,
    payload: InstallModpackPayload,
): Promise<{ queued: boolean; queue_id: string }> =>
    http
        .post(`/api/client/servers/${server}/mods/modpacks/${projectId}/versions/${fileId}/install`, payload)
        .then(r => r.data);
