import http from '@/lib/http';

// Admin billing settings, node-pricing multipliers, Stripe key management, and
// configuration import/export. All over the existing V1 endpoints under
// /api/application/billing. No backend changes.

// Key/value settings write (currency:code, renewal:default_billing_days,
// keys:publishable, paypal, link, plan_change_cooldown_hours, …). The everest
// billing config store is the read source; this persists a single key.
export async function updateBillingSetting(key: string, value: unknown): Promise<void> {
    await http.put('/api/application/billing/settings', { key, value });
}

// Removes the stored Stripe publishable + secret keys.
export async function deleteStripeKeys(): Promise<void> {
    await http.delete('/api/application/billing/keys');
}

// --- node pricing -------------------------------------------------------------

export interface NodePricing {
    id: number;
    name: string;
    priceMultiplier: number;
    priceMultiplierDescription: string | null;
    deployable: boolean;
    deployableFree: boolean;
}

function toNodePricing(d: any): NodePricing {
    return {
        id: d.id,
        name: d.name,
        priceMultiplier: Number(d.price_multiplier ?? 1),
        priceMultiplierDescription: d.price_multiplier_description ?? null,
        deployable: Boolean(d.deployable),
        deployableFree: Boolean(d.deployable_free),
    };
}

export async function getNodePricing(): Promise<NodePricing[]> {
    const { data } = await http.get('/api/application/billing/node-pricing');
    return (data.data ?? []).map(toNodePricing);
}

export interface NodePricingUpdate {
    id: number;
    price_multiplier: number;
    price_multiplier_description?: string | null;
}

export async function batchUpdateNodePricing(nodes: NodePricingUpdate[]): Promise<void> {
    await http.patch('/api/application/billing/node-pricing/batch', { nodes });
}

export async function resetAllNodePricing(): Promise<void> {
    await http.post('/api/application/billing/node-pricing/reset-all');
}

// --- config import / export ---------------------------------------------------

export async function exportBillingConfiguration(): Promise<void> {
    const { data } = await http.post('/api/application/billing/config/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'billing-config.json';
    link.click();
    window.URL.revokeObjectURL(url);
}

export async function importBillingConfiguration(
    uploadedJson: object,
    override: boolean,
    ignoreDuplicates: boolean,
): Promise<void> {
    await http.post('/api/application/billing/config/import', {
        data: uploadedJson,
        override,
        ignore_duplicates: ignoreDuplicates,
    });
}
