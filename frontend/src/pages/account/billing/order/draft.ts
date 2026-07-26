import type { ValidateCouponResponse } from '@/api/accountBilling';

// Checkout hand-off between the configure step and the payment step. Startup
// variables can contain passwords and tokens, so the entire draft is held only
// in module memory. A full reload intentionally requires re-entry.

export interface CheckoutDraft {
    checkoutNonce: string;
    productId: number;
    nodeId: number;
    cycleDays: number;
    eggId?: number;
    vars: [string, string][];
    couponId?: number;
    couponData: ValidateCouponResponse | null;
    serverName: string;
}

const drafts = new Map<string, CheckoutDraft>();

export function saveDraft(draft: CheckoutDraft): void {
    drafts.set(String(draft.productId), draft);
}

export function readDraft(productId: number | string): CheckoutDraft | null {
    return drafts.get(String(productId)) ?? null;
}

export function clearDraft(productId: number | string): void {
    drafts.delete(String(productId));
}

export function clearAllDrafts(): void {
    drafts.clear();
}
