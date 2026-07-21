import http from '@/lib/http';

// Billing categories — the top level of the product catalog. A category binds a
// nest/egg (and an allowed-egg set) and owns a collection of products.
// Sourced from /api/application/billing/categories (CategoryTransformer).
//
// NOTE: the category→products `include` is unreliable (the backend hasMany omits
// the uuid local key, so it resolves against `categories.id` and returns 0), so
// products are loaded per-category via the products endpoint (see billingProducts.ts).

export interface BillingCategory {
    id: number;
    uuid: string;
    name: string;
    icon: string | null;
    description: string | null;
    visible: boolean;
    nestId: number;
    eggId: number;
    allowedEggs: number[];
    allowEggChanges: boolean;
    allowPlanChanges: boolean;
}

// Mirrors the camelCase body the controller reads (CategoryController::store).
export interface CategoryValues {
    name: string;
    icon: string | null;
    description: string | null;
    visible: boolean;
    eggId: number;
    allowedEggs: number[];
    allowEggChanges: boolean;
    allowPlanChanges: boolean;
}

function toCategory(row: any): BillingCategory {
    const a = row.attributes ?? row;
    return {
        id: a.id,
        uuid: a.uuid,
        name: a.name,
        icon: a.icon ?? null,
        description: a.description && a.description.length > 0 ? a.description : null,
        visible: Boolean(a.visible),
        nestId: a.nest_id,
        eggId: a.egg_id,
        allowedEggs: a.allowedEggs ?? (a.egg_id ? [a.egg_id] : []),
        allowEggChanges: Boolean(a.allowEggChanges),
        allowPlanChanges: Boolean(a.allowPlanChanges),
    };
}

export async function getCategories(): Promise<BillingCategory[]> {
    const { data } = await http.get('/api/application/billing/categories', {
        params: { per_page: 100 },
    });
    return (data.data ?? []).map(toCategory);
}

export async function getCategory(id: number | string): Promise<BillingCategory> {
    const { data } = await http.get(`/api/application/billing/categories/${id}`);
    // Single-item responses wrap the payload in `data`; collections use `data[]`.
    return toCategory(data.data ?? data);
}

export async function createCategory(values: CategoryValues): Promise<BillingCategory> {
    const { data } = await http.post('/api/application/billing/categories', values);
    return toCategory(data.data ?? data);
}

export async function updateCategory(id: number, values: CategoryValues): Promise<void> {
    await http.patch(`/api/application/billing/categories/${id}`, values);
}

export async function deleteCategory(id: number): Promise<void> {
    await http.delete(`/api/application/billing/categories/${id}`);
}
