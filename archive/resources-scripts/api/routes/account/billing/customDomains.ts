import http from '@/api/http';

export interface AvailableCustomDomain {
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

export const getAvailableCustomDomains = async (eggId?: number): Promise<AvailableCustomDomain[]> => {
    const query = eggId ? `?egg_id=${eggId}` : '';
    const { data } = await http.get(`/api/client/billing/custom-domains/options${query}`);

    return data.data || [];
};
