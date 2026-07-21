import type { ValidateCouponResponse } from '@/api/accountBilling';

// Checkout hand-off between the configure step and the payment step. Persisted
// to sessionStorage (keyed by product) so the payment page survives a refresh,
// mirroring V1's useCheckoutDraft.

export interface CheckoutDraft {
    productId: number;
    nodeId: number;
    cycleDays: number;
    eggId?: number;
    vars: [string, string][];
    couponId?: number;
    couponData: ValidateCouponResponse | null;
    serverName: string;
}

const key = (productId: number | string) => `v2:checkout:draft:${productId}`;

export function saveDraft(draft: CheckoutDraft): void {
    try {
        sessionStorage.setItem(key(draft.productId), JSON.stringify(draft));
    } catch {
        /* sessionStorage unavailable — non-fatal */
    }
}

export function readDraft(productId: number | string): CheckoutDraft | null {
    try {
        const raw = sessionStorage.getItem(key(productId));
        return raw ? (JSON.parse(raw) as CheckoutDraft) : null;
    } catch {
        return null;
    }
}

export function clearDraft(productId: number | string): void {
    try {
        sessionStorage.removeItem(key(productId));
    } catch {
        /* noop */
    }
}
