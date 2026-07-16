import http from '@/api/http';

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
