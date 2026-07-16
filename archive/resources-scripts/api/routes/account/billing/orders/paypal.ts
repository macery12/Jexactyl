import http from '@/api/http';

export interface PayPalOrder {
    id: string;
    token: string;
    approval_url: string;
}

export interface PayPalOrderStatus {
    processed: boolean;
    failed: boolean;
    pending: boolean;
    order_id: string;
    order_status: string;
}

export interface PayPalOrderFromToken {
    order_id: string;
    status: string;
    product_id: number;
}

export interface PayPalCaptureResponse {
    success: boolean;
    message: string;
    order_id: number;
}

export const createPayPalOrder = (
    id: number,
    couponId?: number,
    billingDays?: number,
    returnUrl?: string,
    serverId?: number,
    renewal?: boolean,
): Promise<PayPalOrder> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/billing/products/${id}/paypal/order`, {
            coupon_id: couponId,
            billing_days: billingDays,
            return_url: returnUrl,
            server_id: serverId,
            renewal,
        })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const updatePayPalOrder = ({
    id,
    orderId,
    nodeId,
    vars,
    serverId,
    renewal,
    couponId,
    eggId,
    billingDays,
    name,
    domainPayload,
}: {
    id: number;
    orderId: string;
    nodeId?: number;
    vars?: Array<{ key: string; value: string }>;
    serverId?: number;
    renewal?: boolean;
    couponId?: number;
    eggId?: number;
    billingDays?: number;
    name: string;
    domainPayload?: Array<{
        domain_id: number;
        subdomain: string;
        record_type?: 'srv' | 'cname';
    }>;
}): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.put(`/api/client/billing/products/${id}/paypal/order`, {
            order_id: orderId,
            node_id: nodeId,
            variables: vars,
            server_id: serverId,
            renewal,
            coupon_id: couponId,
            egg_id: eggId,
            billing_days: billingDays,
            name,
            domain_payload: domainPayload,
        })
            .then(() => resolve())
            .catch(reject);
    });
};

export const capturePayPalOrder = (orderId: string): Promise<PayPalCaptureResponse> => {
    console.log('[PayPal] Capture API call - Order ID:', orderId);
    return new Promise((resolve, reject) => {
        http.post(`/api/client/billing/paypal/capture`, {
            order_id: orderId,
        })
            .then(({ data }) => {
                console.log('[PayPal] Capture successful:', data);
                resolve(data);
            })
            .catch(error => {
                console.error('[PayPal] Capture failed:', {
                    status: error.response?.status,
                    message: error.response?.data?.message || error.message,
                    fullError: error,
                });
                reject(error);
            });
    });
};

export const checkPayPalOrderStatus = (orderId?: string | null): Promise<PayPalOrderStatus> => {
    return new Promise((resolve, reject) => {
        const url = orderId
            ? `/api/client/billing/paypal/status?order_id=${orderId}`
            : `/api/client/billing/paypal/status`;

        http.get(url)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getOrderIdFromToken = (token: string): Promise<PayPalOrderFromToken> => {
    return new Promise((resolve, reject) => {
        http.get(`/api/client/billing/paypal/token/${token}`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};
