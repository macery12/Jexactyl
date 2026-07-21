import http from '@/api/http';

export interface MarketplaceSettings {
    enabled?: boolean;
    default_source?: string;
    allow_external_downloads?: boolean;
    curseforge_cdn_fallback?: boolean;
    curseforge_enabled?: boolean;
    // Only sent when the admin is setting/changing the key; never returned by the API.
    curseforge_api_key?: string;
    download_max_concurrent?: number;
    download_max_per_minute?: number;
    download_max_queue_size?: number;
    max_mod_size?: number;
    max_plugin_size?: number;
}

export const updateSettings = (settings: MarketplaceSettings): Promise<void> =>
    http.put(`/api/application/plugins/settings`, settings).then(() => {});

export interface RateLimitUsage {
    requests_this_minute: number;
    requests_this_hour: number;
    limit_per_minute: number;
    limit_per_hour: number;
}

export interface MarketplaceAnalytics {
    totals: {
        installs: number;
        by_provider: { modrinth: number; spigot: number; curseforge: number };
        failures: number;
        retries: number;
        bandwidth_bytes: number;
        bandwidth_bytes_24h: number;
    };
    queue: {
        pending: number;
        downloading: number;
        failed_24h: number;
    };
    trends: {
        last_24h: Array<{ timestamp: string; installs: number }>;
        last_7d: Array<{ date: string; installs: number }>;
    };
    provider_health: Record<
        string,
        {
            enabled: boolean;
            rate_limit: RateLimitUsage | null;
            denied_by_policy: number;
        }
    >;
}

export const getMarketplaceAnalytics = (): Promise<MarketplaceAnalytics> =>
    http.get(`/api/application/plugins/analytics`).then(({ data }) => data);

