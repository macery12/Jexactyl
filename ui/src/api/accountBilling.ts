import http from '@/lib/http';

// Account-facing storefront/checkout API. Mirrors V1's
// resources/scripts/api/routes/account/billing/* against the existing
// /api/client/billing/* endpoints — no backend changes. Wire shapes follow the
// PterodactylSerializer: collections under `data[]` with `attributes`, single
// items as bare `{ attributes }`, and a few plain-JSON endpoints (eggs, cycles,
// coupon, profile, stripe key/intent) that return their body directly.

export interface StoreCategory {
    id: number;
    name: string;
    icon: string | null;
    description: string | null;
    allowedEggs: number[];
    allowEggChanges: boolean;
    allowPlanChanges: boolean;
}

export interface ProductLimits {
    cpu: number;
    memory: number;
    disk: number;
    backup: number;
    database: number;
    allocation: number;
    subdomain: number | null;
}

export interface StoreProduct {
    id: number;
    name: string;
    icon: string | null;
    price: number;
    description: string | null;
    eggId: number;
    allowedEggs: number[];
    allowEggChanges: boolean;
    limits: ProductLimits;
}

export interface ViableNode {
    id: number;
    name: string;
    fqdn: string;
    priceMultiplier: number;
    priceMultiplierDescription: string | null;
}

export interface ProductCycle {
    id?: number;
    days: number;
    price: number;
    multiplier: number;
    discountPercent: number;
    isDefault: boolean;
    label?: string;
}

export interface EggInfo {
    id: number;
    name: string;
    description: string;
}

export interface StoreEggVariable {
    name: string;
    description: string;
    envVariable: string;
    defaultValue: string;
    isEditable: boolean;
    rules: string[];
}

export interface ValidateCouponResponse {
    valid: boolean;
    coupon: { id: number; code: string; type: 'percentage' | 'fixed'; value: number };
    subtotal: number;
    discount: number;
    total: number;
}

export interface BillingProfile {
    first_name: string | null;
    last_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
    phone: string | null;
    updated_at: string | null;
}

export interface StripeIntent {
    id: string;
    secret: string;
}

// ---- transformers -----------------------------------------------------------

function toCategory(row: any): StoreCategory {
    const a = row.attributes ?? row;
    return {
        id: a.id,
        name: a.name,
        icon: a.icon ?? null,
        description: a.description ?? null,
        allowedEggs: a.allowedEggs ?? (a.eggId ? [a.eggId] : []),
        allowEggChanges: a.allowEggChanges ?? true,
        allowPlanChanges: a.allowPlanChanges ?? true,
    };
}

function toProduct(row: any): StoreProduct {
    const a = row.attributes ?? row;
    const l = a.limits ?? {};
    return {
        id: a.id,
        name: a.name,
        icon: a.icon ?? null,
        price: Number(a.price ?? 0),
        description: a.description ?? null,
        eggId: a.egg_id,
        allowedEggs: a.allowed_eggs ?? (a.egg_id ? [a.egg_id] : []),
        allowEggChanges: a.allow_egg_changes ?? true,
        limits: {
            cpu: Number(l.cpu ?? 0),
            memory: Number(l.memory ?? 0),
            disk: Number(l.disk ?? 0),
            backup: Number(l.backup ?? 0),
            database: Number(l.database ?? 0),
            allocation: Number(l.allocation ?? 0),
            subdomain: l.subdomain ?? null,
        },
    };
}

function toNode(row: any): ViableNode {
    const a = row.attributes ?? row;
    return {
        id: a.id,
        name: a.name,
        fqdn: a.fqdn,
        priceMultiplier: a.price_multiplier ?? 1.0,
        priceMultiplierDescription: a.price_multiplier_description ?? null,
    };
}

function toVariable(row: any): StoreEggVariable {
    const a = row.attributes ?? row;
    return {
        name: a.name,
        description: a.description ?? '',
        envVariable: a.env_variable,
        defaultValue: a.default_value ?? '',
        isEditable: Boolean(a.is_editable),
        rules: typeof a.rules === 'string' ? a.rules.split('|') : (a.rules ?? []),
    };
}

// ---- catalog ----------------------------------------------------------------

export async function getStoreCategories(): Promise<StoreCategory[]> {
    const { data } = await http.get('/api/client/billing/categories');
    return (data.data ?? []).map(toCategory);
}

export async function getCategoryProducts(categoryId: number): Promise<StoreProduct[]> {
    const { data } = await http.get(`/api/client/billing/categories/${categoryId}`);
    return (data.data ?? []).map(toProduct);
}

export async function getStoreProduct(productId: number): Promise<StoreProduct> {
    const { data } = await http.get(`/api/client/billing/products/${productId}`);
    return toProduct(data);
}

export async function getProductVariables(productId: number): Promise<StoreEggVariable[]> {
    const { data } = await http.get(`/api/client/billing/products/${productId}/variables`);
    return (data.data ?? []).map(toVariable);
}

export async function getEggInfo(eggId: number): Promise<EggInfo> {
    const { data } = await http.get(`/api/client/billing/eggs/${eggId}`);
    return data;
}

export async function getViableNodes(productId: number): Promise<ViableNode[]> {
    const { data } = await http.post(`/api/client/billing/nodes/${productId}`);
    return (data.data ?? []).map(toNode);
}

export async function getProductBillingCycles(productId: number): Promise<ProductCycle[]> {
    const { data } = await http.get(`/api/client/billing/products/${productId}/billing-cycles`);
    return (data.data ?? []).map((c: any) => ({
        id: c.id,
        days: c.days,
        price: Number(c.price ?? 0),
        multiplier: Number(c.multiplier ?? 1),
        discountPercent: Number(c.discount_percent ?? 0),
        isDefault: Boolean(c.is_default),
        label: c.label,
    }));
}

// ---- coupon -----------------------------------------------------------------

export async function validateCoupon(
    code: string,
    subtotal: number,
    orderType = 'new',
): Promise<ValidateCouponResponse> {
    const { data } = await http.post('/api/client/billing/coupons/validate', {
        code,
        subtotal,
        order_type: orderType,
    });
    return data;
}

// ---- billing profile --------------------------------------------------------

export async function getBillingProfile(): Promise<BillingProfile | null> {
    const { data } = await http.get('/api/client/billing/profile');
    return data ?? null;
}

export function hasCompleteBillingProfile(profile: BillingProfile | null): boolean {
    if (!profile) return false;
    return [
        profile.first_name,
        profile.last_name,
        profile.address_line1,
        profile.city,
        profile.state,
        profile.postal_code,
        profile.country,
    ].every(v => typeof v === 'string' && v.trim().length > 0);
}

// Fields the store/update endpoints accept (country is a 2-letter ISO code).
export interface BillingProfileInput {
    first_name: string;
    last_name: string;
    address_line1: string;
    address_line2?: string | null;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    phone?: string | null;
}

// The profile has no dedicated PATCH: POST creates, PUT updates. `exists`
// tells us which the backend expects (POST 409s when one already exists, PUT
// 404s when none does). Callers derive it from a prior getBillingProfile().
export async function saveBillingProfile(input: BillingProfileInput, exists: boolean): Promise<BillingProfile> {
    const { data } = exists
        ? await http.put('/api/client/billing/profile', input)
        : await http.post('/api/client/billing/profile', input);
    return data;
}

// ---- free order -------------------------------------------------------------

export interface FreeOrderPayload {
    product: number;
    node?: number;
    variables?: { key: string; value: string }[];
    coupon_id?: number;
    egg_id?: number;
    name?: string;
    billing_days?: number;
}

export async function processFreeOrder(payload: FreeOrderPayload): Promise<unknown> {
    const { data } = await http.post('/api/client/billing/process/free', {
        renewal: undefined,
        server_id: undefined,
        domain_payload: undefined,
        ...payload,
    });
    return data;
}

export async function processPaidOrder(intent: string, renewal?: boolean): Promise<unknown> {
    const { data } = await http.post('/api/client/billing/process', { intent, renewal });
    return data;
}

// ---- stripe -----------------------------------------------------------------

export async function getStripeKey(productId: number): Promise<{ key: string }> {
    const { data } = await http.get(`/api/client/billing/products/${productId}/key`);
    return data;
}

export async function getStripeIntent(
    productId: number,
    couponId?: number,
    billingDays?: number,
): Promise<StripeIntent> {
    const { data } = await http.post(`/api/client/billing/products/${productId}/intent`, {
        coupon_id: couponId,
        billing_days: billingDays,
    });
    return data;
}

export interface UpdateStripeIntentInput {
    productId: number;
    intent: string;
    nodeId: number;
    vars: { key: string; value: string }[];
    couponId?: number;
    eggId?: number;
    name: string;
    billingDays: number;
}

export async function updateStripeIntent(input: UpdateStripeIntentInput): Promise<void> {
    await http.put(`/api/client/billing/products/${input.productId}/intent`, {
        intent: input.intent,
        node_id: input.nodeId,
        variables: input.vars,
        coupon_id: input.couponId,
        egg_id: input.eggId,
        name: input.name,
        billing_days: input.billingDays,
    });
}

// ---- paypal (redirect flow, no SDK) -----------------------------------------

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

export interface PayPalCaptureResponse {
    success: boolean;
    message: string;
    order_id: number;
}

export async function createPayPalOrder(
    productId: number,
    couponId?: number,
    billingDays?: number,
    returnUrl?: string,
): Promise<PayPalOrder> {
    const { data } = await http.post(`/api/client/billing/products/${productId}/paypal/order`, {
        coupon_id: couponId,
        billing_days: billingDays,
        return_url: returnUrl,
    });
    return data;
}

export interface UpdatePayPalOrderInput {
    productId: number;
    orderId: string;
    nodeId: number;
    vars: { key: string; value: string }[];
    couponId?: number;
    eggId?: number;
    billingDays: number;
    name: string;
}

export async function updatePayPalOrder(input: UpdatePayPalOrderInput): Promise<void> {
    await http.put(`/api/client/billing/products/${input.productId}/paypal/order`, {
        order_id: input.orderId,
        node_id: input.nodeId,
        variables: input.vars,
        coupon_id: input.couponId,
        egg_id: input.eggId,
        billing_days: input.billingDays,
        name: input.name,
    });
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalCaptureResponse> {
    const { data } = await http.post('/api/client/billing/paypal/capture', { order_id: orderId });
    return data;
}

export async function checkPayPalOrderStatus(orderId?: string | null): Promise<PayPalOrderStatus> {
    const url = orderId
        ? `/api/client/billing/paypal/status?order_id=${orderId}`
        : '/api/client/billing/paypal/status';
    const { data } = await http.get(url);
    return data;
}

export async function getOrderIdFromToken(
    token: string,
): Promise<{ order_id: string; status: string; product_id: number }> {
    const { data } = await http.get(`/api/client/billing/paypal/token/${token}`);
    return data;
}

// ---- variable field helper --------------------------------------------------

export interface VariableFieldModel {
    env: string;
    label: string;
    description: string;
    kind: 'select' | 'number' | 'text';
    options?: string[];
}

// Derive a render model from an egg variable's Laravel rule string: `in:a,b,c`
// → a select; `integer`/`numeric` → number; otherwise text.
export function toFieldModel(v: StoreEggVariable): VariableFieldModel {
    const inRule = v.rules.find(r => r.startsWith('in:'));
    if (inRule) {
        return {
            env: v.envVariable,
            label: v.name,
            description: v.description,
            kind: 'select',
            options: inRule.slice(3).split(',').filter(Boolean),
        };
    }
    const numeric = v.rules.some(r => r === 'integer' || r === 'numeric');
    return {
        env: v.envVariable,
        label: v.name,
        description: v.description,
        kind: numeric ? 'number' : 'text',
    };
}
