import http from '@/api/http';
import type { Mod, ModSearchResponse } from '@/api/routes/server/mods';

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
    // Mismatch flags added by the controller
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
    // Wipe the entire server before installing (clean install).
    wipe_server: boolean;
    // Install the modpack's mod loader (Forge/NeoForge/Fabric) via the script endpoint.
    install_loader: boolean;
}

export interface ModpackLoaderStatus {
    has_loader: boolean;
    detected: 'forge' | 'neoforge' | 'fabric' | 'quilt' | null;
}

export const searchModpacks = (
    uuid: string,
    params: {
        searchFilter?: string;
        sortField?: string;
        // 'latest' | 'any' | a specific MC version (e.g. '1.20.1')
        gameVersion?: string;
        // 'forge' | 'neoforge' | 'fabric' | 'quilt'
        loader?: string;
        pageSize?: number;
        index?: number;
    },
): Promise<ModSearchResponse> =>
    http.get(`/api/client/servers/${uuid}/mods/modpacks/search`, { params }).then(r => r.data);

export const getModpack = (uuid: string, projectId: number): Promise<{ data: Mod }> =>
    http.get(`/api/client/servers/${uuid}/mods/modpacks/${projectId}`).then(r => r.data);

export const getModpackVersions = (
    uuid: string,
    projectId: number,
    gameVersion?: string,
    loader?: string,
): Promise<{ data: ModpackVersion[] }> =>
    http
        .get(`/api/client/servers/${uuid}/mods/modpacks/${projectId}/versions`, { params: { gameVersion, loader } })
        .then(r => r.data);

// Release Minecraft versions (newest first) for the version filter dropdown.
export const getModpackMinecraftVersions = (uuid: string): Promise<{ data: string[] }> =>
    http.get(`/api/client/servers/${uuid}/mods/modpacks/minecraft-versions`).then(r => r.data);

// Detect whether a mod loader is already installed on the server (filesystem scan).
export const getModpackLoaderStatus = (uuid: string): Promise<ModpackLoaderStatus> =>
    http.get(`/api/client/servers/${uuid}/mods/modpacks/loader-status`).then(r => r.data);

export const previewModpackInstall = (uuid: string, projectId: number, fileId: number): Promise<ModpackPreview> =>
    http.post(`/api/client/servers/${uuid}/mods/modpacks/${projectId}/versions/${fileId}/preview`).then(r => r.data);

export const installModpack = (
    uuid: string,
    projectId: number,
    fileId: number,
    payload: InstallModpackPayload,
): Promise<{ queued: boolean; queue_id: string }> =>
    http
        .post(`/api/client/servers/${uuid}/mods/modpacks/${projectId}/versions/${fileId}/install`, payload)
        .then(r => r.data);
