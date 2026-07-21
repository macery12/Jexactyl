import http, { PaginatedResult } from '@/api/http';

export type ProviderKey = 'modrinth' | 'spigot';
export type ContentType = 'mods' | 'plugins';

export interface PluginCapabilityResponse {
    mods: ProviderKey[];
    plugins: ProviderKey[];
}

export const getPluginCapabilities = (uuid: string): Promise<PluginCapabilityResponse> =>
    http.get(`/api/client/servers/${uuid}/plugins/capabilities`).then(r => r.data);

export type InstalledAddonType = 'mod' | 'plugin';
export type InstalledContentType = 'mods' | 'plugins';
export type InstalledStatusFilter = 'all' | 'enabled' | 'disabled';

export interface InstalledAddon {
    filename: string;
    friendlyName: string;
    path: string;
    sizeBytes: number;
    modifiedAt: Date | null;
    type: InstalledAddonType;
    enabled: boolean;
}

const toInstalledAddon = (raw: any): InstalledAddon => ({
    // Backward compatible with legacy keys from earlier installed response.
    filename: raw?.filename ?? raw?.name ?? '',
    friendlyName: raw?.friendly_name ?? raw?.display_name ?? raw?.name ?? '',
    path: raw?.path ?? '',
    sizeBytes: Number(raw?.size_bytes ?? raw?.size ?? 0),
    modifiedAt: raw?.modified_at ? new Date(raw.modified_at) : null,
    type: (raw?.type ?? 'mod') as InstalledAddonType,
    enabled:
        typeof raw?.enabled === 'boolean' ? raw.enabled : typeof raw?.disabled === 'boolean' ? !raw.disabled : false,
});

export interface InstalledAddonQuery {
    type: InstalledContentType;
    page?: number;
    perPage?: number;
    search?: string;
    status?: InstalledStatusFilter;
}

export const getInstalledAddons = (
    uuid: string,
    query: InstalledAddonQuery,
): Promise<PaginatedResult<InstalledAddon>> =>
    http
        .get(`/api/client/servers/${uuid}/plugins/installed`, {
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
    uuid: string,
    payload: { type: InstalledContentType; path: string; enable: boolean },
): Promise<InstalledAddon> =>
    http
        .post(`/api/client/servers/${uuid}/plugins/installed/toggle`, payload)
        .then(r => toInstalledAddon(r.data?.item ?? {}));
