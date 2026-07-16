import http from '@/lib/http';

// Admin-side custom domains module (Application API). Operators curate the
// catalog of parent domains users can build subdomains on, the pool of
// Cloudflare API keys, and the global module settings. Mirrors V1's
// `api/routes/admin/customDomains.ts`; reuses `/api/application/custom-domains`
// — no backend changes.

export interface AdminCustomDomain {
    id: number;
    domain: string;
    cloudflareZoneId: string | null;
    apiKeyId: number | null;
    apiKeyName: string | null;
    allowedNestIds: number[];
    allowedEggIds: number[];
    serviceTag: string | null;
    eggServiceTags: Record<string, string>;
    wildcardEnabled: boolean;
    enabled: boolean;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface CustomDomainApiKey {
    id: number;
    name: string;
    enabled: boolean;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface CustomDomainNest {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
}

export interface CustomDomainEgg {
    id: number;
    uuid: string;
    nest_id: number;
    nest_name: string | null;
    name: string;
    description: string | null;
    default_service_tag: string | null;
}

export interface CustomDomainOptions {
    nests: CustomDomainNest[];
    eggs: CustomDomainEgg[];
}

export interface CustomDomainSettings {
    enabled: boolean;
    cloudflareToken: string;
    allowWildcard: boolean;
    maxWildcardsPerUser: number;
    rateLimitCreatePerMinute: number;
    rateLimitSyncPerMinute: number;
    rateLimitBillingOptionsPerMinute: number;
}

export interface DomainPayload {
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

function toDomain(row: any): AdminCustomDomain {
    return {
        id: row.id,
        domain: row.domain,
        cloudflareZoneId: row.cloudflare_zone_id ?? null,
        apiKeyId: row.api_key_id ?? null,
        apiKeyName: row.api_key_name ?? null,
        allowedNestIds: (row.allowed_nest_ids ?? []).map(Number),
        allowedEggIds: (row.allowed_egg_ids ?? []).map(Number),
        serviceTag: row.service_tag ?? null,
        eggServiceTags: (row.egg_service_tags ?? {}) as Record<string, string>,
        wildcardEnabled: Boolean(row.wildcard_enabled),
        enabled: Boolean(row.enabled),
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
    };
}

function toApiKey(row: any): CustomDomainApiKey {
    return {
        id: row.id,
        name: row.name,
        enabled: Boolean(row.enabled),
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
    };
}

const BASE = '/api/application/custom-domains';

// --- Catalog domains ---

export async function getAdminCustomDomains(): Promise<AdminCustomDomain[]> {
    const { data } = await http.get(BASE);
    return (data.data ?? []).map(toDomain);
}

export async function createAdminCustomDomain(payload: DomainPayload): Promise<void> {
    await http.post(BASE, payload);
}

export async function updateAdminCustomDomain(id: number, payload: DomainPayload): Promise<void> {
    await http.patch(`${BASE}/${id}`, payload);
}

export async function deleteAdminCustomDomain(id: number): Promise<void> {
    await http.delete(`${BASE}/${id}`);
}

export async function getCustomDomainCatalogOptions(): Promise<CustomDomainOptions> {
    const { data } = await http.get(`${BASE}/options`);
    return {
        nests: data.data?.nests ?? [],
        eggs: data.data?.eggs ?? [],
    };
}

// --- Cloudflare API keys ---

export async function getCustomDomainApiKeys(): Promise<CustomDomainApiKey[]> {
    const { data } = await http.get(`${BASE}/api-keys`);
    return (data.data ?? []).map(toApiKey);
}

export async function createCustomDomainApiKey(payload: { name: string; token: string; enabled: boolean }): Promise<void> {
    await http.post(`${BASE}/api-keys`, payload);
}

export async function updateCustomDomainApiKey(
    id: number,
    payload: { name?: string; token?: string; enabled?: boolean },
): Promise<void> {
    await http.patch(`${BASE}/api-keys/${id}`, payload);
}

export async function deleteCustomDomainApiKey(id: number): Promise<void> {
    await http.delete(`${BASE}/api-keys/${id}`);
}

// --- Module settings ---

export async function getCustomDomainSettings(): Promise<CustomDomainSettings> {
    const { data } = await http.get(`${BASE}/settings`);
    const d = data.data ?? {};
    return {
        enabled: Boolean(d.enabled),
        cloudflareToken: String(d.cloudflare_token ?? ''),
        allowWildcard: Boolean(d.allow_wildcard),
        maxWildcardsPerUser: Number(d.max_wildcards_per_user ?? 1),
        rateLimitCreatePerMinute: Number(d.rate_limit_create_per_minute ?? 10),
        rateLimitSyncPerMinute: Number(d.rate_limit_sync_per_minute ?? 5),
        rateLimitBillingOptionsPerMinute: Number(d.rate_limit_billing_options_per_minute ?? 20),
    };
}

export async function updateCustomDomainSettings(payload: Partial<{
    enabled: boolean;
    cloudflare_token: string;
    allow_wildcard: boolean;
    max_wildcards_per_user: number;
    rate_limit_create_per_minute: number;
    rate_limit_sync_per_minute: number;
    rate_limit_billing_options_per_minute: number;
}>): Promise<void> {
    await http.put(`${BASE}/settings`, payload);
}
