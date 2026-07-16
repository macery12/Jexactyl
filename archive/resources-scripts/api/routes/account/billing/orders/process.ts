import { Server } from '@definitions/server';
import http from '@/api/http';

export const processPaidOrder = (intent: string, renewal?: boolean): Promise<string> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/billing/process`, { intent, renewal })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const processUnpaidOrder = (
    product: number,
    node?: number,
    renewal?: boolean,
    variables?: { key: string; value: string }[],
    server_id?: number,
    coupon_id?: number,
    egg_id?: number,
    name?: string,
    domain_payload?: Array<{
        domain_id: number;
        subdomain: string;
        record_type?: 'srv' | 'cname';
    }>,
    billing_days?: number,
): Promise<Server> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/billing/process/free`, {
            server_id,
            node,
            product,
            renewal,
            variables,
            coupon_id,
            egg_id,
            name,
            domain_payload,
            billing_days,
        })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const renewFreeServer = (
    product: number,
    server_id: number,
    coupon_id?: number,
    billing_days?: number,
): Promise<Server> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/billing/renew/free`, { product, server_id, coupon_id, billing_days })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};
