import http from '@/lib/http';
import type { StoreConfiguration } from '@/lib/globals';

// Admin client for the storefront configuration (/api/application/billing/store).
// Session-authed, gated by the BILLING_UPDATE admin permission server-side.

export async function getStoreConfig(): Promise<StoreConfiguration> {
    const { data } = await http.get<StoreConfiguration>('/api/application/billing/store');
    return data;
}

export async function updateStoreConfig(config: StoreConfiguration): Promise<void> {
    await http.patch('/api/application/billing/store', {
        enabled: config.enabled,
        sections: config.sections,
    });
}
