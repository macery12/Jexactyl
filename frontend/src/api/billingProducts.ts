import http from '@/lib/http';

// Billing products (plans) — live under a category. Sourced from
// /api/application/billing/categories/{cat}/products (ProductTransformer).

export interface ProductLimits {
    cpu: number;
    memory: number;
    disk: number;
    backup: number;
    database: number;
    allocation: number;
    subdomain: number;
}

export interface BillingProduct {
    id: number;
    uuid: string;
    categoryUuid: string;
    name: string;
    icon: string | null;
    price: number;
    basePrice: number | null;
    description: string | null;
    limits: ProductLimits;
}

export interface BillingCycle {
    id: number;
    days: number;
    price: number;
    multiplier: number;
    discountPercent: number;
    isDefault: boolean;
    isEnabled: boolean;
}

// Editable form values. The product controller READS the nested `limits` object,
// while StoreBillingProductRequest VALIDATES flat `*_limit` keys as required — so
// the create/update payload sends BOTH (verified against the live endpoint).
export interface ProductValues {
    name: string;
    icon: string | null;
    price: number;
    base_price: number | null;
    description: string | null;
    visible: boolean;
    limits: ProductLimits;
}

export function toProduct(row: any): BillingProduct {
    const a = row.attributes ?? row;
    const l = a.limits ?? {};
    return {
        id: a.id,
        uuid: a.uuid,
        categoryUuid: a.category_uuid,
        name: a.name,
        icon: a.icon ?? null,
        price: Number(a.price ?? 0),
        basePrice: a.base_price != null ? Number(a.base_price) : null,
        description: a.description && a.description.length > 0 ? a.description : null,
        limits: {
            cpu: Number(l.cpu ?? 0),
            memory: Number(l.memory ?? 0),
            disk: Number(l.disk ?? 0),
            backup: Number(l.backup ?? 0),
            database: Number(l.database ?? 0),
            allocation: Number(l.allocation ?? 0),
            subdomain: Number(l.subdomain ?? 0),
        },
    };
}

// Build the wire payload: nested limits (controller read) + flat *_limit (validation).
function toPayload(categoryUuid: string, v: ProductValues): Record<string, unknown> {
    return {
        category_uuid: categoryUuid,
        name: v.name,
        icon: v.icon,
        price: v.price,
        base_price: v.base_price,
        description: v.description,
        visible: v.visible,
        limits: v.limits,
        cpu_limit: v.limits.cpu,
        memory_limit: v.limits.memory,
        disk_limit: v.limits.disk,
        backup_limit: v.limits.backup,
        database_limit: v.limits.database,
        allocation_limit: v.limits.allocation,
        subdomain_limit: v.limits.subdomain,
    };
}

export async function getProducts(categoryId: number | string): Promise<BillingProduct[]> {
    const out: BillingProduct[] = [];
    let page = 1;
    for (let safety = 0; safety < 50; safety++) {
        const { data } = await http.get(`/api/application/billing/categories/${categoryId}/products`, {
            params: { per_page: 100, page },
        });
        out.push(...(data.data ?? []).map(toProduct));
        const pagination = data.meta?.pagination;
        if (!pagination || page >= (pagination.total_pages ?? 1)) break;
        page += 1;
    }
    return out;
}

export async function getProduct(categoryId: number | string, productId: number | string): Promise<BillingProduct> {
    const { data } = await http.get(
        `/api/application/billing/categories/${categoryId}/products/${productId}`,
    );
    // Single-item responses wrap the payload in `data`; collections use `data[]`.
    return toProduct(data.data ?? data);
}

export async function createProduct(
    categoryId: number | string,
    categoryUuid: string,
    values: ProductValues,
): Promise<BillingProduct> {
    const { data } = await http.post(
        `/api/application/billing/categories/${categoryId}/products`,
        toPayload(categoryUuid, values),
    );
    return toProduct(data.data ?? data);
}

export async function updateProduct(
    categoryId: number | string,
    productId: number,
    categoryUuid: string,
    values: ProductValues,
): Promise<void> {
    await http.patch(
        `/api/application/billing/categories/${categoryId}/products/${productId}`,
        toPayload(categoryUuid, values),
    );
}

export async function deleteProduct(categoryId: number | string, productId: number): Promise<void> {
    await http.delete(`/api/application/billing/categories/${categoryId}/products/${productId}`);
}

// ---- Billing cycles ---------------------------------------------------------

export async function getBillingCycles(
    categoryId: number | string,
    productId: number | string,
): Promise<BillingCycle[]> {
    const { data } = await http.get(
        `/api/application/billing/categories/${categoryId}/products/${productId}/billing-cycles`,
    );
    return (data.data ?? []).map((c: any) => ({
        id: c.id,
        days: c.days,
        price: Number(c.price ?? 0),
        multiplier: Number(c.multiplier ?? 1),
        discountPercent: Number(c.discount_percent ?? 0),
        isDefault: Boolean(c.is_default),
        isEnabled: Boolean(c.is_enabled),
    }));
}

export interface CycleSyncValue {
    days: number;
    is_enabled: boolean;
}

export async function syncBillingCycles(
    categoryId: number | string,
    productId: number,
    cycles: CycleSyncValue[],
): Promise<void> {
    await http.post(
        `/api/application/billing/categories/${categoryId}/products/${productId}/billing-cycles/sync`,
        { cycles },
    );
}

export async function deleteBillingCycle(
    categoryId: number | string,
    productId: number,
    cycleId: number,
): Promise<void> {
    await http.delete(
        `/api/application/billing/categories/${categoryId}/products/${productId}/billing-cycles/${cycleId}`,
    );
}
