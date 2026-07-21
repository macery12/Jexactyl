export type OrderStatus = 'pending' | 'expired' | 'failed' | 'cancelled' | 'processed';
export type OrderType = 'new' | 'upg' | 'ren';
export type PaymentProcessor = 'stripe' | 'paypal' | 'free';

export interface OrderFilters {
    id?: number;
    name?: string;
    payment_processor?: PaymentProcessor;
    status?: OrderStatus;
    type?: OrderType;
    min_amount?: number;
    max_amount?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
}

export interface UpdateStripeIntent {
    id: number;
    node_id?: number;
    intent: string;
    vars?: { key: string; value: string }[];
    serverId?: number;
    renewal?: boolean;
    coupon_id?: number;
    egg_id?: number;
    name?: string;
    billing_days?: number;
    domain_payload?: Array<{
        domain_id: number;
        subdomain: string;
        record_type?: 'srv' | 'cname';
    }>;
}
