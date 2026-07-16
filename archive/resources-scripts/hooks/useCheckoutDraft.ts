import { useState } from 'react';
import { ValidateCouponResponse } from '@/api/routes/account/billing/coupons';

const DRAFT_KEY_PREFIX = 'checkout_draft';

export interface CheckoutDraft {
    productId: number;
    selectedNode: number;
    selectedBillingDays: number;
    selectedEggId?: number;
    vars: [string, string][];
    couponId?: number;
    couponData?: ValidateCouponResponse | null;
    serverName: string;
}

function defaultDraft(productId: number): CheckoutDraft {
    return {
        productId,
        selectedNode: 0,
        selectedBillingDays: 30,
        vars: [],
        serverName: '',
    };
}

export function useCheckoutDraft(productId: number) {
    const storageKey = `${DRAFT_KEY_PREFIX}_${productId}`;

    const [draft, setDraftState] = useState<CheckoutDraft>(() => {
        try {
            const saved = sessionStorage.getItem(storageKey);
            if (saved) {
                const parsed = JSON.parse(saved) as CheckoutDraft;
                // Validate that the saved draft is for the same product
                if (parsed.productId === productId) {
                    return parsed;
                }
            }
        } catch {
            // Invalid JSON or unavailable sessionStorage — start fresh
        }
        return defaultDraft(productId);
    });

    const setDraft = (update: Partial<CheckoutDraft>) => {
        setDraftState(prev => {
            const next = { ...prev, ...update };
            try {
                sessionStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                // sessionStorage unavailable (e.g. private browsing limits) — in-memory only
            }
            return next;
        });
    };

    const clearDraft = () => {
        try {
            sessionStorage.removeItem(storageKey);
        } catch {
            // ignore
        }
        setDraftState(defaultDraft(productId));
    };

    return { draft, setDraft, clearDraft };
}
