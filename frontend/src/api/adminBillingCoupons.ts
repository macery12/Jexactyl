import http from '@/lib/http';

// Admin billing coupons — list/create/update/delete over the existing V1
// endpoints under /api/application/billing/coupons. No backend changes.

export type CouponType = 'percentage' | 'fixed';
export type CouponAllowedFor = 'both' | 'purchases' | 'renewals';

export interface Coupon {
    id: number;
    code: string;
    type: CouponType;
    value: number;
    maxUses: number | null;
    maxUsesPerUser: number | null;
    minOrderTotal: number | null;
    expiresAt: string | null;
    isActive: boolean;
    allowedFor: CouponAllowedFor;
    usageCount: number;
    createdAt: string;
    updatedAt: string | null;
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

function toCoupon(row: any): Coupon {
    const a = row.attributes ?? row;
    return {
        id: a.id,
        code: a.code,
        type: a.type,
        value: Number(a.value ?? 0),
        maxUses: a.max_uses ?? null,
        maxUsesPerUser: a.max_uses_per_user ?? null,
        minOrderTotal: a.min_order_total != null ? Number(a.min_order_total) : null,
        expiresAt: a.expires_at ?? null,
        isActive: Boolean(a.is_active),
        allowedFor: a.allowed_for ?? 'both',
        usageCount: Number(a.usage_count ?? 0),
        createdAt: a.created_at,
        updatedAt: a.updated_at ?? null,
    };
}

// Returns the full coupon list, walking pages so we don't blow past the API's
// per_page cap (max 100). Coupon counts are small, so this is a couple requests
// at most.
export async function getCoupons(): Promise<Coupon[]> {
    const perPage = 100;
    let page = 1;
    const all: Coupon[] = [];
     
    while (true) {
        const { data } = await http.get('/api/application/billing/coupons', { params: { page, per_page: perPage } });
        all.push(...(data.data ?? []).map(toCoupon));
        const p = data.meta?.pagination;
        if (!p || page >= (p.total_pages ?? 1)) break;
        page += 1;
    }
    return all;
}

function toPayload(v: Partial<CouponValues>): Record<string, unknown> {
    return {
        code: v.code,
        type: v.type,
        value: v.value,
        max_uses: v.maxUses,
        max_uses_per_user: v.maxUsesPerUser,
        min_order_total: v.minOrderTotal,
        expires_at: v.expiresAt,
        is_active: v.isActive,
        allowed_for: v.allowedFor,
    };
}

export async function createCoupon(values: CouponValues): Promise<Coupon> {
    const { data } = await http.post('/api/application/billing/coupons', toPayload(values));
    return toCoupon(data);
}

export async function updateCoupon(id: number, values: Partial<CouponValues>): Promise<void> {
    await http.patch(`/api/application/billing/coupons/${id}`, toPayload(values));
}

export async function deleteCoupon(id: number): Promise<void> {
    await http.delete(`/api/application/billing/coupons/${id}`);
}
