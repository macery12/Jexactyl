import http from '@/api/http';

export interface NodePricing {
    id: number;
    name: string;
    price_multiplier: number;
    price_multiplier_description?: string | null;
    deployable: boolean;
    deployable_free: boolean;
}

export interface NodePricingUpdate {
    id: number;
    price_multiplier: number;
    price_multiplier_description?: string | null;
}

export const getNodePricing = (): Promise<NodePricing[]> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/application/billing/node-pricing`)
            .then(({ data }) => resolve(data.data || []))
            .catch(reject);
    });
};

export const updateNodePricing = (
    id: number,
    priceMultiplier: number,
    priceMultiplierDescription?: string | null,
): Promise<NodePricing> => {
    return new Promise((resolve, reject) => {
        http.patch(`/api/application/billing/node-pricing/${id}`, {
            price_multiplier: priceMultiplier,
            price_multiplier_description: priceMultiplierDescription,
        })
            .then(({ data }) => resolve(data.data))
            .catch(reject);
    });
};

export const batchUpdateNodePricing = (nodes: NodePricingUpdate[]): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.patch(`/api/application/billing/node-pricing/batch`, { nodes })
            .then(() => resolve())
            .catch(reject);
    });
};

export const resetNodePricing = (id: number): Promise<NodePricing> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/application/billing/node-pricing/${id}/reset`)
            .then(({ data }) => resolve(data.data))
            .catch(reject);
    });
};

export const resetAllNodePricing = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/application/billing/node-pricing/reset-all`)
            .then(() => resolve())
            .catch(reject);
    });
};
