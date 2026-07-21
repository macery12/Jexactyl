import useSWR from 'swr';
import http from '@/api/http';
import { ServerContext } from '@/state/server';

export interface ServerCustomDomainRecord {
    id: number;
    domain_id: number;
    domain: string;
    subdomain: string;
    full_domain: string;
    port: number;
    protocol: 'tcp' | 'udp' | 'both';
    service_tag: string | null;
    record_type: 'srv' | 'cname';
    host_record_type: 'A' | 'CNAME' | null;
    status: 'pending' | 'active' | 'failed';
    last_error: string | null;
    last_synced_at: string | null;
}

export interface AvailableServerCustomDomain {
    id: number;
    domain: string;
    wildcard_enabled: boolean;
    default_service_tag: string | null;
    recommended_record_type: 'srv' | 'cname';
    srv_supported: boolean;
    allow_record_type_selection: boolean;
    forced_record_type: 'srv' | 'cname' | null;
    dns_mode: 'minecraft' | 'rust' | 'generic';
    recommendation_notice: string;
    connection_hint: string;
}

export const getServerCustomDomains = () => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);

    return useSWR<ServerCustomDomainRecord[]>(
        ['server:custom-domains', uuid],
        async () => {
            const { data } = await http.get(`/api/client/servers/${uuid}/custom-domains`);

            return data.data || [];
        },
        { revalidateOnFocus: false },
    );
};

export const createServerCustomDomain = async (
    uuid: string,
    payload: {
        domain_id: number;
        subdomain: string;
        port: number;
        protocol: 'tcp' | 'udp' | 'both';
        record_type?: 'srv' | 'cname';
        service_tag?: string;
    },
): Promise<void> => {
    await http.post(`/api/client/servers/${uuid}/custom-domains`, payload);
};

export const getServerCustomDomainOptions = async (uuid: string): Promise<AvailableServerCustomDomain[]> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/custom-domains/options`);

    return data.data || [];
};

export const deleteServerCustomDomain = async (uuid: string, id: number): Promise<void> => {
    await http.delete(`/api/client/servers/${uuid}/custom-domains/${id}`);
};

export const syncServerCustomDomains = async (uuid: string): Promise<void> => {
    await http.post(`/api/client/servers/${uuid}/custom-domains/sync`);
};
