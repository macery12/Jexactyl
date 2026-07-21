import { useFlags } from '@/state/flags';
import { formatCurrency } from '@/lib/format';
import type { BillingConfig } from '@/lib/globals';

const FALLBACK: BillingConfig = {
    enabled: false,
    currency: { symbol: '$', code: 'USD' },
    links: { terms: '#', privacy: '#' },
};

// Storefront billing config + a currency formatter bound to the configured
// currency code. Use across the store/checkout instead of the USD-defaulted
// formatCurrency so totals render in the panel's real currency.
export function useBilling() {
    const billing = (useFlags(s => s.everest?.billing) as BillingConfig | undefined) ?? FALLBACK;
    const code = (billing.currency?.code ?? 'USD').toUpperCase();
    const money = (amount: number) => formatCurrency(amount, code);

    const stripeEnabled = Boolean(billing.processors?.stripe?.enabled && billing.processors?.stripe?.available);
    const paypalEnabled = Boolean(billing.processors?.paypal?.enabled && billing.processors?.paypal?.available);

    return { billing, money, stripeEnabled, paypalEnabled };
}
