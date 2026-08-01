import { m } from '@/i18n';
import { Link } from 'react-router-dom';
import { Star, ArrowRight } from 'lucide-react';
import { useBilling } from '@/state/billing';
import type { StoreProduct } from '@/api/accountBilling';
import { SpecChips } from '../order/parts';

// Spotlight for one highlighted plan, shown above the grid. `product` is chosen
// by the page (an operator-pinned plan, or the first plan by default). The badge
// and CTA text fall back to the translated defaults when not overridden.
export function FeaturedPlan({
    product,
    badgeLabel,
    ctaLabel,
}: {
    product: StoreProduct;
    badgeLabel?: string;
    ctaLabel?: string;
}) {
    const { money } = useBilling();
    return (
        <section className="overflow-hidden rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/[0.07]">
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)]/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--brand)]">
                        <Star className="h-3.5 w-3.5" /> {badgeLabel || m['billing.store.featured.badge']()}
                    </span>
                    <h3 className="mt-3 text-xl font-bold text-[var(--color-ink)]">{product.name}</h3>
                    {product.description && (
                        <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-muted)]">{product.description}</p>
                    )}
                    <div className="mt-4">
                        <SpecChips limits={product.limits} />
                    </div>
                </div>
                <div className="shrink-0 sm:text-right">
                    <p className="text-3xl font-bold text-[var(--color-ink)]">
                        {product.price === 0 ? m['billing.store.free']() : money(product.price)}
                    </p>
                    {product.price > 0 && (
                        <p className="text-xs text-[var(--color-ink-faint)]">{m['billing.store.perMonth']()}</p>
                    )}
                    <Link to={`/checkout/configure/${product.id}`} className="mt-4 inline-block">
                        <span className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-5 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]">
                            {ctaLabel || m['billing.store.featured.cta']()} <ArrowRight className="h-4 w-4" />
                        </span>
                    </Link>
                </div>
            </div>
        </section>
    );
}
