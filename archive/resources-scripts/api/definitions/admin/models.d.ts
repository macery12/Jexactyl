import { ModelWithRelationships, Model, UUID } from '@definitions';
import { Server } from '@/api/routes/admin/server';
import { OrderType } from '@/api/routes/account/billing/orders/types';

type BillingExceptionType = 'payment' | 'deployment' | 'storefront' | 'webhook' | 'refund' | 'validation';
type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
type OrderStatus = 'pending' | 'expired' | 'failed' | 'cancelled' | 'processed';

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

interface User extends ModelWithRelationships {
    id: number;
    uuid: UUID;
    externalId: string;
    username: string;
    email: string;
    language: string;
    admin_role_id: number | null;
    roleName: string;
    isRootAdmin: boolean;
    isUsingTwoFactor: boolean;
    avatarUrl: string;
    state: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    relationships: {
        role: UserRole | null;
        // TODO: just use an API call, this is probably a bad idea for performance.
        servers?: Server[];
    };
}

interface UserRole extends ModelWithRelationships {
    id: number;
    name: string;
    description: string;
    color?: string | null;
    permissions: string[];
}

interface ApiKeyPermission extends Model {
    r_allocations: string;
    r_database_hosts: string;
    r_eggs: string;
    r_locations: string;
    r_nests: string;
    r_nodes: string;
    r_server_databases: string;
    r_servers: string;
    r_users: string;
}

interface ApiKey extends Model {
    id?: number;
    identifier: string;
    description: string;
    allowed_ips: string[];
    created_at: Date | null;
    last_used_at: Date | null;
}

interface BillingException extends Model {
    id: number;
    uuid: string;
    exception_type: BillingExceptionType;
    order_id?: number;
    title: string;
    description: string;
    created_at: Date;
    updated_at?: Date | null;
}

interface Ticket extends Model {
    id: number;
    title: string;
    user: User;
    assigned_to?: User | undefined;
    status: TicketStatus;
    priority: TicketPriority;
    last_reply_at?: Date | null;
    created_at: Date;
    updated_at?: Date | null;
    relationships: {
        messages?: TicketMessage[];
    };
}

interface TicketMessage extends Model {
    id: number;
    message: string;
    internal_note: boolean;
    author: User;
    created_at: Date;
    updated_at?: Date | null;
}

interface BillingAnalytics extends Model {
    orders: Order[];
    products: Product[];
    categories: Category[];
    upcomingRenewals?: {
        overdue: {
            count: number;
            expectedRevenue: number;
        };
        in7Days: {
            count: number;
            expectedRevenue: number;
        };
        in8to14Days: {
            count: number;
            expectedRevenue: number;
        };
        total14Days: {
            count: number;
            expectedRevenue: number;
        };
    };
    forecast?: {
        next7Days: number;
        next30Days: number;
    };
    suspendedServers?: SuspendedServer[];
    recentEvents?: BillingEvent[];
}

interface SuspendedServer {
    id: number;
    uuid: string;
    name: string;
    owner: string;
    owner_email?: string;
}

interface BillingEvent {
    id: number;
    date: Date;
    type: string;
    status: string;
    payment_processor: string;
    total: number;
    server_id?: number;
    server_uuid?: string;
    server_name?: string;
}

interface Order extends Model {
    id: number;
    name: string;
    user_id: number;
    username?: string | null;
    user_email?: string | null;
    description: string;
    total: number;
    status: OrderStatus;
    product_id: number;
    product_name?: string | null;
    type: OrderType;
    threat_index: number;
    payment_processor: 'stripe' | 'paypal' | 'free';
    transaction: PaymentTransaction | null;
    subtotal?: number | null;
    discount?: number | null;
    billing_days?: number | null;
    coupon_id?: number | null;
    node_id?: number | null;
    final_price?: number | null;
    egg_id?: number | null;
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
    updated_at?: Date | null;
}

interface Product extends Model {
    id: number;
    uuid: string;
    categoryUuid: number;

    name: string;
    icon?: string;
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

    createdAt: Date;
    updatedAt?: Date | null;

    relationships: {
        category?: Category;
    };
}

interface BillingCycle extends Model {
    id: number;
    productId: number;
    days: number;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt?: Date | null;
}

interface BillingCycleWithPrice {
    id?: number;
    days: number;
    price: number;
    multiplier: number;
    discountPercent: number;
    isDefault: boolean;
    isEnabled?: boolean;
}

interface Category extends Model {
    id: number;
    uuid: string;
    name: string;
    icon: string;
    description: string;
    visible: boolean;
    nestId: number;
    eggId: number;
    allowedEggs: number[];
    allowEggChanges: boolean;
    allowPlanChanges: boolean;

    createdAt: Date;
    updatedAt?: Date | null;

    relationships: {
        products?: Product[];
    };
}

interface Coupon extends Model {
    id: number;
    code: string;
    type: 'percentage' | 'fixed';
    value: number;
    maxUses: number | null;
    maxUsesPerUser: number | null;
    minOrderTotal: number | null;
    expiresAt: Date | null;
    isActive: boolean;
    allowedFor: 'both' | 'purchases' | 'renewals';
    usageCount: number;
    createdAt: Date;
    updatedAt?: Date | null;
}

interface AdminRolePermission extends Model {
    key: string;
    description: string;
}

interface ServerPreset extends Model {
    id: number;
    name: string;
    description: string;

    cpu: number;
    memory: number;
    disk: number;
    nest_id?: number;
    egg_id?: number;

    created_at: Date;
    updated_at?: Date | null;
}
