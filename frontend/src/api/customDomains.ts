import http from '@/lib/http';

// Server-side (client API) custom domains. A server owner maps a subdomain of an
// admin-provided parent domain to their server; the backend provisions real DNS
// records (CNAME, or SRV for Minecraft/Rust-family eggs) through Cloudflare.
// Mirrors V1's `api/routes/server/customDomains.ts`; reuses the existing
// `/api/client/servers/{server}/custom-domains` surface — no backend changes.

export type DomainStatus = 'pending' | 'active' | 'failed';
export type RecordType = 'srv' | 'cname';

export interface CustomDomainMapping {
    id: number;
    domainId: number;
    domain: string | null;
    subdomain: string;
    fullDomain: string;
    port: number;
    protocol: string;
    serviceTag: string | null;
    recordType: RecordType;
    hostRecordType: string | null;
    status: DomainStatus;
    lastError: string | null;
    lastSyncedAt: string | null;
}

// A parent domain the current server is allowed to use, plus the DNS
// recommendation the backend computed for this server's egg.
export interface CustomDomainOption {
    id: number;
    domain: string;
    wildcardEnabled: boolean;
    defaultServiceTag: string | null;
    recommendedRecordType: RecordType;
    srvSupported: boolean;
    allowRecordTypeSelection: boolean;
    forcedRecordType: RecordType | null;
    dnsMode: string;
    recommendationNotice: string | null;
    connectionHint: string | null;
}

export interface CreateMappingPayload {
    domainId: number;
    subdomain: string;
    port: number;
    recordType?: RecordType | null;
    serviceTag?: string | null;
}

function toMapping(row: any): CustomDomainMapping {
    return {
        id: row.id,
        domainId: row.domain_id,
        domain: row.domain ?? null,
        subdomain: row.subdomain,
        fullDomain: row.full_domain,
        port: row.port,
        protocol: row.protocol,
        serviceTag: row.service_tag ?? null,
        recordType: row.record_type,
        hostRecordType: row.host_record_type ?? null,
        status: row.status,
        lastError: row.last_error ?? null,
        lastSyncedAt: row.last_synced_at ?? null,
    };
}

function toOption(row: any): CustomDomainOption {
    return {
        id: row.id,
        domain: row.domain,
        wildcardEnabled: Boolean(row.wildcard_enabled),
        defaultServiceTag: row.default_service_tag ?? null,
        recommendedRecordType: row.recommended_record_type,
        srvSupported: Boolean(row.srv_supported),
        allowRecordTypeSelection: Boolean(row.allow_record_type_selection),
        forcedRecordType: row.forced_record_type ?? null,
        dnsMode: row.dns_mode,
        recommendationNotice: row.recommendation_notice ?? null,
        connectionHint: row.connection_hint ?? null,
    };
}

const base = (uuid: string) => `/api/client/servers/${uuid}/custom-domains`;

export async function getCustomDomains(uuid: string): Promise<CustomDomainMapping[]> {
    const { data } = await http.get(base(uuid));
    return (data.data ?? []).map(toMapping);
}

export async function getCustomDomainOptions(uuid: string): Promise<CustomDomainOption[]> {
    const { data } = await http.get(`${base(uuid)}/options`);
    return (data.data ?? []).map(toOption);
}

export async function createCustomDomain(uuid: string, payload: CreateMappingPayload): Promise<void> {
    await http.post(base(uuid), {
        domain_id: payload.domainId,
        subdomain: payload.subdomain,
        port: payload.port,
        protocol: 'both',
        record_type: payload.recordType ?? null,
        service_tag: payload.serviceTag ?? null,
    });
}

// Re-queue provisioning for every mapping on the server (used to retry failures).
export async function syncCustomDomains(uuid: string): Promise<void> {
    await http.post(`${base(uuid)}/sync`);
}

export async function deleteCustomDomain(uuid: string, id: number): Promise<void> {
    await http.delete(`${base(uuid)}/${id}`);
}
