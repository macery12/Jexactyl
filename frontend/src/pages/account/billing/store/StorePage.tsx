import { useBilling } from '@/state/billing';
import type { StoreSection } from '@/lib/globals';
import StoreCanvas from './StoreCanvas';

// Built-in fallback used when no store config was injected (e.g. composer failed
// or customisation is disabled). Mirrors the original hero → catalog → trust bar
// layout so an un-customised panel looks exactly as it did before.
const DEFAULT_SECTIONS: StoreSection[] = [
    { id: 'hero', enabled: true, order: 0, data: {} },
    { id: 'catalog', enabled: true, order: 1, data: {} },
    { id: 'trust', enabled: true, order: 2, data: {} },
];

// Storefront (/billing/order). The section structure is operator-customisable
// via /admin/billing/store; blank copy fields fall back to the translated
// billing.store.* defaults.
export default function StorePage() {
    const { billing } = useBilling();
    const store = billing.store;
    const sections = store && store.enabled ? store.sections : DEFAULT_SECTIONS;

    return <StoreCanvas sections={sections} />;
}
