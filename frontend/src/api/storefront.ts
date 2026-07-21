import http from '@/lib/http';

// Public, unauthenticated storefront catalog client (/api/storefront/catalog).
// IP rate-limited server-side. Used by the landing page pricing section to show
// logged-out visitors the available products. Exposes only the slim, public-safe
// shape — no egg/nest ids or internal flags.

export interface StorefrontProductLimits {
    cpu: number;
    memory: number;
    disk: number;
    backup: number;
    database: number;
    allocation: number;
    subdomain: number | null;
}

export interface StorefrontProduct {
    id: number;
    name: string;
    icon: string | null;
    price: number;
    description: string | null;
    limits: StorefrontProductLimits;
}

export interface StorefrontCategory {
    id: number;
    name: string;
    icon: string | null;
    description: string | null;
    products: StorefrontProduct[];
}

export async function getCatalog(): Promise<StorefrontCategory[]> {
    const { data } = await http.get<{ data: StorefrontCategory[] }>('/api/storefront/catalog');
    return data.data ?? [];
}
