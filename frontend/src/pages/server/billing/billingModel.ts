import type { StoreProduct, ProductCycle } from '@/api/accountBilling';
import { calculateGracePeriodDays } from '@/api/serverBilling';

// Renewal settings block off the everest billing config. Every field is
// optional — V1 defaults each one at the point of use, and so do we.
export interface RenewalSettings {
    days?: number;
    free_renewal_days?: number;
    free_suspension_days?: number;
    suspension_threshold?: number;
    suspension_threshold_percentage?: number;
    min_suspension_threshold_days?: number;
    max_suspension_threshold_days?: number;
    default_billing_days?: number;
    multiplier_steps?: string | unknown[];
}

export type RenewalState = 'active' | 'available' | 'grace' | 'overdue';

export interface BillingModel {
    /** Whole days until renewal; negative once overdue. */
    daysRemaining: number;
    /** Hours component of the remaining time, for the "3 days, 4 hours" readout. */
    hoursRemaining: number;
    daysOverdue: number;
    /** Days the server may sit unpaid before suspension — cycle-length derived. */
    gracePeriod: number;
    state: RenewalState;
    /** Cycle length actually billed, falling back to the panel default. */
    billingDays: number;
    /** Price for the current cycle; falls back to the product's base price. */
    price: number;
    cycle: ProductCycle | null;
    isFree: boolean;
    /** True once a suspended server is past the hard cutoff — self-service payment closes. */
    paymentDisabled: boolean;
    maxSuspensionDays: number;
    /** Free servers can only renew inside the grace window, not months ahead. */
    renewableInDays: number;
}

function timeUntil(target: string): { days: number; hours: number } {
    const diffMs = new Date(target).getTime() - Date.now();
    return {
        days: Math.floor(diffMs / 86_400_000),
        hours: Math.floor((diffMs / 3_600_000) % 24),
    };
}

/**
 * Derives everything the billing page renders from the server's renewal date,
 * its product/cycle, and the panel's renewal settings. Ported from the
 * calculations V1 spread across ServerBillingContainer's body.
 */
export function buildBillingModel(input: {
    renewalDate: string | null;
    serverBillingDays: number | null;
    isSuspended: boolean;
    product: StoreProduct | undefined;
    cycle: ProductCycle | null;
    renewal: RenewalSettings;
}): BillingModel {
    const { renewalDate, serverBillingDays, isSuspended, product, cycle, renewal } = input;

    const { days: daysRemaining, hours: hoursRemaining } = renewalDate
        ? timeUntil(renewalDate)
        : { days: 0, hours: 0 };
    const daysOverdue = daysRemaining < 0 ? Math.abs(daysRemaining) : 0;

    const isFree = (product?.price ?? 0) === 0;
    const billingDays = isFree
        ? (renewal.free_renewal_days ?? 30)
        : (serverBillingDays || renewal.days || 30);
    const freeGraceDays = renewal.free_suspension_days ?? 7;

    // Without a product we can't tell a free plan from a paid one, so fall back
    // to the flat configured threshold rather than guessing a cycle-derived one.
    const gracePeriod = product
        ? serverBillingDays
            ? calculateGracePeriodDays(serverBillingDays, isFree, renewal)
            : isFree
              ? freeGraceDays
              : (renewal.suspension_threshold ?? 7)
        : (renewal.suspension_threshold ?? 7);

    const maxSuspensionDays = renewal.max_suspension_threshold_days ?? 7;

    let state: RenewalState = 'active';
    if (daysRemaining < 0) state = daysOverdue > freeGraceDays ? 'overdue' : 'grace';
    else if (daysRemaining <= gracePeriod) state = 'available';

    return {
        daysRemaining,
        hoursRemaining,
        daysOverdue,
        gracePeriod,
        state,
        billingDays,
        price: cycle?.price ?? product?.price ?? 0,
        cycle,
        isFree,
        paymentDisabled: daysOverdue > maxSuspensionDays && isSuspended,
        maxSuspensionDays,
        renewableInDays: Math.max(0, daysRemaining - gracePeriod),
    };
}
