import http from '@/api/http';

export interface AddressSuggestion {
    label: string;
    line1: string;
    city: string;
    state: string;
    postal_code: string;
    country_code: string;
}

/**
 * Search for address suggestions using the backend Nominatim proxy.
 * The query must be at least 3 characters.
 */
export const searchAddress = (q: string): Promise<AddressSuggestion[]> =>
    http
        .get('/api/client/billing/address-autocomplete', { params: { q } })
        .then(({ data }) => (Array.isArray(data) ? data : []));
