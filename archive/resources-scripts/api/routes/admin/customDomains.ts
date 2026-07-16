import http from '@/api/http';

export interface AdminCustomDomain {
    id: number;
    domain: string;
    cloudflare_zone_id: string | null;
    api_key_id: number | null;
    api_key_name: string | null;
    allowed_nest_ids: number[];
    allowed_egg_ids: number[];
    service_tag: string | null;
    egg_service_tags: Record<string, string>;
    wildcard_enabled: boolean;
    enabled: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface CustomDomainApiKey {
    id: number;
    name: string;
    enabled: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface CreateAdminCustomDomainPayload {
    domain: string;
    cloudflare_zone_id?: string | null;
    api_key_id?: number | null;
    allowed_nest_ids?: number[];
    allowed_egg_ids?: number[];
    service_tag?: string | null;
    egg_service_tags?: Record<string, string>;
    wildcard_enabled?: boolean;
    enabled?: boolean;
}

export interface UpdateAdminCustomDomainPayload {
    domain?: string;
    cloudflare_zone_id?: string | null;
    api_key_id?: number | null;
    allowed_nest_ids?: number[];
    allowed_egg_ids?: number[];
    service_tag?: string | null;
    egg_service_tags?: Record<string, string>;
    wildcard_enabled?: boolean;
    enabled?: boolean;
}

export interface CustomDomainTargetOptions {
    nests: Array<{ id: number; uuid: string; name: string; description: string | null }>;
    eggs: Array<{
        id: number;
        uuid: string;
        nest_id: number;
        nest_name: string;
        name: string;
        description: string | null;
        default_service_tag: string | null;
    }>;
}

export interface CustomDomainSettings {
    enabled: boolean;
    cloudflare_token: string;
    allow_wildcard: boolean;
    max_wildcards_per_user: number;
    rate_limit_create_per_minute: number;
    rate_limit_sync_per_minute: number;
    rate_limit_billing_options_per_minute: number;
}

export const getCustomDomains = async (): Promise<AdminCustomDomain[]> => {
    const { data } = await http.get('/api/application/custom-domains');

    return data.data || [];
};

export const createCustomDomain = async (payload: CreateAdminCustomDomainPayload): Promise<AdminCustomDomain> => {
    const { data } = await http.post('/api/application/custom-domains', payload);

    return data.data;
};

export const updateCustomDomain = async (
    id: number,
    payload: UpdateAdminCustomDomainPayload,
): Promise<AdminCustomDomain> => {
    const { data } = await http.patch(`/api/application/custom-domains/${id}`, payload);

    return data.data;
};

export const deleteCustomDomain = async (id: number): Promise<void> => {
    await http.delete(`/api/application/custom-domains/${id}`);
};

export const getCustomDomainApiKeys = async (): Promise<CustomDomainApiKey[]> => {
    const { data } = await http.get('/api/application/custom-domains/api-keys');

    return data.data || [];
};

export const createCustomDomainApiKey = async (payload: {
    name: string;
    token: string;
    enabled?: boolean;
}): Promise<CustomDomainApiKey> => {
    const { data } = await http.post('/api/application/custom-domains/api-keys', payload);

    return data.data;
};

export const updateCustomDomainApiKey = async (
    id: number,
    payload: { name?: string; token?: string; enabled?: boolean },
): Promise<CustomDomainApiKey> => {
    const { data } = await http.patch(`/api/application/custom-domains/api-keys/${id}`, payload);

    return data.data;
};

export const deleteCustomDomainApiKey = async (id: number): Promise<void> => {
    await http.delete(`/api/application/custom-domains/api-keys/${id}`);
};

export const getCustomDomainTargetOptions = async (): Promise<CustomDomainTargetOptions> => {
    const { data } = await http.get('/api/application/custom-domains/options');

    return data.data;
};

export const getCustomDomainSettings = async (): Promise<CustomDomainSettings> => {
    const { data } = await http.get('/api/application/custom-domains/settings');

    return data.data;
};

export const updateCustomDomainSettings = async (payload: Partial<CustomDomainSettings>): Promise<void> => {
    await http.put('/api/application/custom-domains/settings', payload);
};
