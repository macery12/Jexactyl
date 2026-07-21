import http from '@/lib/http';
import type { StoreProduct } from '@/api/accountBilling';

// Per-server billing: renewal, plan changes, and egg (server type) changes.
// Mirrors V1's api/routes/server/billing.ts plus the renewal-flavoured calls
// that V1 kept in account/billing/orders/*. Hits the existing endpoints under
// /api/client/servers/{uuid}/billing and /api/client/billing — no backend
// changes. Product/cycle/coupon shapes are reused from accountBilling.ts.

// The plan list comes back through the same serializer as the storefront, so
// the storefront transformer applies. Re-declared here to avoid exporting the
// private one.
function toPlan(row: any): StoreProduct {
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

/**
 * A plan's price is quoted for the panel's default cycle length; any other
 * cycle is priced per-day and scaled by the multiplier step whose `maxDays`
 * first covers the requested length (falling back to the longest step). Ported
 * from V1's ChangePlanContainer so the estimate shown in the plan list matches
 * what the backend charges.
 *
 * This is only an estimate for the list — once a plan is picked we price it
 * from its real billing cycles instead.
 */
export interface MultiplierStep {
    maxDays: number;
    multiplier: number;
}

export function parseMultiplierSteps(raw: unknown): MultiplierStep[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as MultiplierStep[];
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function estimatePlanPrice(
    plan: Pick<StoreProduct, 'price'>,
    days: number,
    defaultBillingDays: number,
    steps: MultiplierStep[],
): { price: number; discount: number } {
    const perDay = plan.price / defaultBillingDays;

    let multiplier = 1.0;
    if (steps.length > 0) {
        const sorted = [...steps].sort((a, b) => a.maxDays - b.maxDays);
        const match = sorted.find(step => days <= step.maxDays);
        multiplier = match?.multiplier ?? sorted[sorted.length - 1]?.multiplier ?? 1.0;
    }

    const finalPrice = perDay * days * multiplier;
    const standardPrice = perDay * days;
    const discountPercent = standardPrice > 0 ? ((standardPrice - finalPrice) / standardPrice) * 100 : 0;

    return {
        price: Math.round(finalPrice * 100) / 100,
        discount: Math.round(discountPercent * 10) / 10,
    };
}

/**
 * Grace window before a lapsed server is suspended: 20% of the cycle length,
 * clamped to [3, 7] days. Free servers use the flat free-server window instead.
 * Mirrors the backend's own calculation.
 */
export function calculateGracePeriodDays(
    days: number,
    isFree: boolean,
    renewal: {
        free_suspension_days?: number;
        suspension_threshold_percentage?: number;
        min_suspension_threshold_days?: number;
        max_suspension_threshold_days?: number;
    } = {},
): number {
    if (isFree) return renewal.free_suspension_days ?? 7;

    const percentage = renewal.suspension_threshold_percentage ?? 0.2;
    const min = renewal.min_suspension_threshold_days ?? 3;
    const max = renewal.max_suspension_threshold_days ?? 7;

    return Math.max(min, Math.min(max, Math.ceil(days * percentage)));
}

// ---- plans ------------------------------------------------------------------

export async function getAvailablePlans(uuid: string): Promise<StoreProduct[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/billing/plans`);
    return (data.data ?? []).map(toPlan);
}

export interface PlanChangeViolation {
    current: number;
    limit: number;
    unit: string;
}

export interface PlanChangeValidation {
    valid: boolean;
    message: string;
    violations?: Record<string, PlanChangeViolation>;
}

export async function validatePlanChange(uuid: string, productId: number): Promise<PlanChangeValidation> {
    const { data } = await http.get(`/api/client/servers/${uuid}/billing/plans/${productId}/validate`);
    return data;
}

export async function changePlan(uuid: string, productId: number, billingDays?: number): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/billing/plans/${productId}/change`, {
        billing_days: billingDays,
    });
}

// ---- egg (server type) ------------------------------------------------------

export async function changeEgg(uuid: string, eggId: number, deleteFiles = false): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/settings/change-egg`, {
        egg_id: eggId,
        delete_files: deleteFiles,
    });
}

// ---- renewal ----------------------------------------------------------------

/** Renews a server whose cost this cycle is zero — free plan, or free via coupon. */
export async function renewFreeServer(
    productId: number,
    serverId: number,
    couponId?: number,
    billingDays?: number,
): Promise<void> {
    await http.post('/api/client/billing/renew/free', {
        product: productId,
        server_id: serverId,
        coupon_id: couponId,
        billing_days: billingDays,
    });
}

/**
 * Stamps the renewal context onto a Stripe intent before confirmation, so the
 * webhook renews this server rather than provisioning a new one. The checkout
 * flow's updateStripeIntent carries node/variables/name instead; a renewal has
 * none of those.
 */
export async function updateRenewalStripeIntent(input: {
    productId: number;
    intent: string;
    serverId: number;
    billingDays?: number;
}): Promise<void> {
    await http.put(`/api/client/billing/products/${input.productId}/intent`, {
        intent: input.intent,
        server_id: input.serverId,
        renewal: true,
        billing_days: input.billingDays,
    });
}

export async function createRenewalPayPalOrder(input: {
    productId: number;
    serverId: number;
    couponId?: number;
    returnUrl: string;
    cancelUrl?: string;
}): Promise<{ id: string; token: string; approval_url: string }> {
    const { data } = await http.post(`/api/client/billing/products/${input.productId}/paypal/order`, {
        coupon_id: input.couponId,
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        server_id: input.serverId,
        renewal: true,
    });
    return data;
}
