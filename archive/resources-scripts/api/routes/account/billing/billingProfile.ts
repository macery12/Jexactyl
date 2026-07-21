import http from '@/api/http';

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

export type BillingProfileInput = Omit<BillingProfile, 'updated_at'>;

/**
 * Fetch the authenticated user's billing profile.
 * Returns null if no profile has been set yet.
 */
export const getBillingProfile = (): Promise<BillingProfile | null> =>
    http.get('/api/client/billing/profile').then(({ data }) => data ?? null);

/**
 * Create or update the authenticated user's billing profile.
 * Uses POST on first creation (404 → no profile), PUT on subsequent updates (409 → already exists).
 */
export const saveBillingProfile = async (data: BillingProfileInput, exists: boolean): Promise<BillingProfile> => {
    const response = exists
        ? await http.put('/api/client/billing/profile', data)
        : await http.post('/api/client/billing/profile', data);

    return response.data;
};
