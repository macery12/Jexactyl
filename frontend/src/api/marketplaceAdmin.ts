import http from '@/lib/http';

// Admin marketplace client — session-authed application API
// (/api/application/plugins/*). Powers the three admin sections: global
// Settings, per-egg provider Access Control, and the Analytics overview.

// Write payload for PUT /api/application/plugins/settings. There is no GET
// counterpart — current values are read from the injected Everest config
// (window.EverestConfiguration.mods) on the admin settings page.
export interface MarketplaceSettings {
    enabled?: boolean;
    default_source?: string;
    allow_external_downloads?: boolean;
    curseforge_cdn_fallback?: boolean;
    curseforge_enabled?: boolean;
    // Only sent when the admin is setting/changing the key.
    curseforge_api_key?: string;
    download_max_concurrent?: number;
    download_max_per_minute?: number;
    download_max_queue_size?: number;
    max_mod_size?: number;
    max_plugin_size?: number;
}

export const updateMarketplaceSettings = (settings: MarketplaceSettings): Promise<void> =>
    http.put('/api/application/plugins/settings', settings).then(() => {});

export interface ProviderRule {
    provider_key: string;
    enabled_global: boolean;
    allowed_nest_ids?: number[];
    allowed_egg_ids?: number[];
}

export interface ProviderRulesResponse {
    nests: Array<{ id: number; name: string; eggs?: Array<{ id: number; name: string; nest_id: number }> }>;
    rules: Record<string, ProviderRule>;
}

export const getProviderRules = (): Promise<ProviderRulesResponse> =>
    http.get('/api/application/plugins/providers').then(r => r.data);

export const updateProviderRules = (payload: ProviderRule): Promise<void> =>
    http.put('/api/application/plugins/providers', payload).then(() => {});

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
    http.get('/api/application/plugins/analytics').then(r => r.data);
