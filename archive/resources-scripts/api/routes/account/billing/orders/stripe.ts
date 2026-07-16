import http from '@/api/http';
import { StripeIntent } from '@definitions/account/billing';
import { UpdateStripeIntent } from '@/api/routes/account/billing/orders/types';

export const getStripeKey = (id: number): Promise<{ key: string }> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/billing/products/${id}/key`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getStripeIntent = (id: number, couponId?: number, billingDays?: number): Promise<StripeIntent> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/billing/products/${id}/intent`, {
            coupon_id: couponId,
            billing_days: billingDays,
        })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const updateStripeIntent = ({
    id,
    intent,
    node_id,
    vars,
    serverId,
    renewal,
    coupon_id,
    egg_id,
    name,
    billing_days,
    domain_payload,
}: UpdateStripeIntent): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.put(`/api/client/billing/products/${id}/intent`, {
            renewal,
            intent,
            node_id,
            variables: vars,
            server_id: serverId,
            coupon_id,
            egg_id,
            name,
            billing_days,
            domain_payload,
        })
            .then(() => resolve())
            .catch(reject);
    });
};
