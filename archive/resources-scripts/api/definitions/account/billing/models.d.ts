import { Model } from '@definitions';
import { OrderType } from '@/api/routes/account/billing/orders/types';

interface PaymentTransaction {
    external_id: string;
    capture_id?: string | null;
    status: string;
    amount: number;
    currency: string;
    payer_id?: string | null;
    payer_email?: string | null;
    captured_at?: Date | null;
}

interface Order extends Model {
    id: number;
    name: string;
    user_id: number;
    description: string;
    total: number;
    product_id: number;
    product_name?: string | null;
    egg_id?: number;
    status: OrderStatus;
    type: OrderType;
    payment_processor: 'stripe' | 'paypal' | 'free';
    transaction: PaymentTransaction | null;
    subtotal?: number | null;
    discount?: number | null;
    billing_days?: number | null;
    coupon_id?: number | null;
    // Legacy fields kept for backward compat (old orders without transaction records)
    payment_intent_id?: string;
    paypal_order_id?: string;
    paypal_capture_id?: string;
    paypal_payer_id?: string;
    paypal_payer_email?: string;
    paypal_status?: string;
    paypal_amount?: number;
    paypal_currency?: string;
    paypal_captured_at?: Date;
    server_id?: number;
    server_uuid?: string;
    server_name?: string;
    created_at: Date;
    updated_at: Date;
}

interface Category extends Model {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    allowedEggs: number[];
    allowEggChanges: boolean;
    allowPlanChanges: boolean;
}

interface Product extends Model {
    id: number;
    name: string;
    icon?: string;
    price: number;
    basePrice?: number;
    description?: string;
    eggId: number;
    allowedEggs: number[];
    allowEggChanges: boolean;
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

interface Node extends Model {
    id: string;
    name: string;
    fqdn: string;
    priceMultiplier?: number;
    priceMultiplierDescription?: string | null;
}

interface StripeIntent extends Model {
    id: string;
    secret: string;
}
