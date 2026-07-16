export type OrderStatus = 'pending' | 'expired' | 'failed' | 'cancelled' | 'processed';
export type PaymentProcessor = 'stripe' | 'paypal' | 'free';

export type CouponType = 'percentage' | 'fixed';
export type CouponAllowedFor = 'both' | 'purchases' | 'renewals';

export interface ProductValues {
    categoryUuid: string;

    name: string;
    icon: string | undefined;
    price: number;
    basePrice?: number | null;
    description: string;

    limits: {
        cpu: number;
        memory: number;
        disk: number;
        backup: number;
        database: number;
        allocation: number;
        subdomain: number | null;
    };
}

export interface CategoryValues {
    name: string;
    icon: string;
    description: string;
    visible: boolean;
    eggId: number;
    allowedEggs?: number[];
    allowEggChanges?: boolean;
    allowPlanChanges?: boolean;
}

export interface CouponValues {
    code: string;
    type: CouponType;
    value: number;
    maxUses: number | null;
    maxUsesPerUser: number | null;
    minOrderTotal: number | null;
    expiresAt: string | null;
    isActive: boolean;
    allowedFor: CouponAllowedFor;
}

export interface ProductFilters {
    id?: string;
    name?: string;
    price?: number;
}

export interface CategoryFilters {
    id?: number;
    name?: string;
}

export interface OrderFilters {
    id?: number;
    name?: string;
    description?: string;
    total?: number;
    payment_processor?: PaymentProcessor;
    status?: OrderStatus;
    type?: string;
    min_amount?: number;
    max_amount?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
    transaction_id?: string;
    capture_id?: string;
    payer_id?: string;
    payer_email?: string;
}

export interface BillingExceptionFilters {
    id?: number;
    title?: string;
}

export interface CouponFilters {
    code?: string;
    type?: CouponType;
    isActive?: boolean;
}
