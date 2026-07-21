import http from '@/lib/http';
import type { FeatureFlags } from '@/features/registry';

// Admin feature-toggle client. Backed by /api/application/settings/features
// (FeaturesController) which reads/writes the `settings::modules:<key>:enabled`
// keys the panel already bridges onto config().

export async function getFeatures(): Promise<FeatureFlags> {
    const { data } = await http.get<{ data: FeatureFlags }>('/api/application/settings/features');
    return data.data;
}

export async function updateFeatures(flags: FeatureFlags): Promise<FeatureFlags> {
    const { data } = await http.put<{ data: FeatureFlags }>('/api/application/settings/features', flags);
    return data.data;
}
