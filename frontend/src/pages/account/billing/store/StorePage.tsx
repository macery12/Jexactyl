import { m } from '@/i18n';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShoppingBag, AlertTriangle, ArrowRight, LayoutGrid, Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { useBilling } from '@/state/billing';
import {
    getStoreCategories,
    getCategoryProducts,
    getProductBillingCycles,
    type StoreProduct,
} from '@/api/accountBilling';
import { StoreHero } from './StoreHero';
import { PaymentTrustBar } from './PaymentTrustBar';
import { FeaturedPlan } from './FeaturedPlan';
import { SavingsCallout } from './SavingsCallout';
import { ComparisonTable } from './ComparisonTable';

type View = 'cards' | 'compare';

const gb = (mib: number) => `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GB`;

// Storefront: marketing hero over the catalog. Categories are a pill row above
// full-width plans (featured spotlight, savings callout, cards/compare toggle),
// then a payment/trust bar.
export default function StorePage() {
    const { billing } = useBilling();
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [view, setView] = useState<View>('cards');

    const categoriesQ = useQuery({ queryKey: ['store', 'categories'], queryFn: getStoreCategories });

    useEffect(() => {
        if (categoryId === null && categoriesQ.data && categoriesQ.data.length > 0) {
            setCategoryId(categoriesQ.data[0]!.id);
        }
    }, [categoriesQ.data, categoryId]);

    const productsQ = useQuery({
        queryKey: ['store', 'products', categoryId],
        queryFn: () => getCategoryProducts(categoryId as number),
        enabled: categoryId != null,
    });

    const products = productsQ.data ?? [];
    const featured = products[0];

    const cyclesQ = useQuery({
        queryKey: ['store', 'cycles', featured?.id],
        queryFn: () => getProductBillingCycles(featured!.id),
        enabled: !!featured,
    });
    const maxDiscount = Math.max(0, ...(cyclesQ.data?.map(c => c.discountPercent) ?? [0]));

    const noProcessors =
        !billing.processors?.stripe?.available && !billing.processors?.paypal?.available;
    const categories = categoriesQ.data ?? [];

    return (
        <div className="flex flex-col gap-10">
            <StoreHero />

            <section id="plans" className="flex flex-col gap-6">
                <div>
                    <h2 className="text-2xl font-semibold tracking-tight">{m['billing.store.title']()}</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['billing.store.subtitle']()}</p>
                </div>

                {categoriesQ.isLoading ? (
                    <div className="flex items-center justify-center py-24">
                        <Spinner className="h-7 w-7" />
                    </div>
                ) : categories.length === 0 ? (
                    <EmptyState message={m['billing.store.noProducts']()} />
                ) : (
                    <>
                        {/* Category pills + view toggle */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <nav className="flex flex-wrap gap-2">
                                {categories.map(cat => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => setCategoryId(cat.id)}
                                        className={cn(
                                            'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
                                            cat.id === categoryId
                                                ? 'border-[var(--brand)] bg-[var(--brand)]/12 text-[var(--color-ink)]'
                                                : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                                        )}
                                    >
                                        {cat.icon ? (
                                            <img src={cat.icon} alt="" className="h-4 w-4 rounded" />
                                        ) : (
                                            <ShoppingBag className="h-4 w-4 text-[var(--color-ink-faint)]" />
                                        )}
                                        {cat.name}
                                    </button>
                                ))}
                            </nav>

                            {products.length > 1 && (
                                <div className="inline-flex rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-1">
                                    <ViewButton icon={LayoutGrid} label={m['billing.store.view.cards']()} active={view === 'cards'} onClick={() => setView('cards')} />
                                    <ViewButton icon={Table2} label={m['billing.store.view.compare']()} active={view === 'compare'} onClick={() => setView('compare')} />
                                </div>
                            )}
                        </div>

                        {noProcessors && (
                            <div className="flex items-center gap-2 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-warning)]">
                                <AlertTriangle className="h-4 w-4" />
                                {m['billing.store.paymentsNotSetup']()}
                            </div>
                        )}

                        {productsQ.isLoading ? (
                            <div className="flex items-center justify-center py-24">
                                <Spinner className="h-7 w-7" />
                            </div>
                        ) : products.length === 0 ? (
                            <EmptyState message={m['billing.store.noProductsInCategory']()} />
                        ) : (
                            <div className="flex flex-col gap-5">
                                {maxDiscount > 0 && <SavingsCallout percent={maxDiscount} />}
                                {view === 'cards' && featured && <FeaturedPlan product={featured} />}

                                {view === 'compare' ? (
                                    <ComparisonTable products={products} />
                                ) : (
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {products.map(product => (
                                            <ProductCard key={product.id} product={product} blocked={product.price > 0 && noProcessors} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </section>

            <PaymentTrustBar />
        </div>
    );
}

function ViewButton({
    icon: Icon,
    label,
    active,
    onClick,
}: {
    icon: typeof LayoutGrid;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                active
                    ? 'bg-[var(--brand)] text-[var(--color-brand-ink)]'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
        >
            <Icon className="h-4 w-4" /> {label}
        </button>
    );
}

function ProductCard({ product, blocked }: { product: StoreProduct; blocked: boolean }) {
    const { money } = useBilling();

    const specs: [string, string][] = [
        [m['billing.store.card.ram'](), gb(product.limits.memory)],
        [m['billing.store.card.cpu'](), `${product.limits.cpu}%`],
        [m['billing.store.card.storage'](), gb(product.limits.disk)],
        ...(product.limits.backup ? [[m['billing.store.card.backups'](), String(product.limits.backup)] as [string, string]] : []),
        ...(product.limits.database ? [[m['billing.store.card.databases'](), String(product.limits.database)] as [string, string]] : []),
        [m['billing.store.card.ports'](), String(product.limits.allocation)],
    ];

    return (
        <div className="flex flex-col rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            {/* Price-led header */}
            <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[var(--color-ink)]">
                    {product.price === 0 ? m['billing.store.free']() : money(product.price)}
                </span>
                {product.price > 0 && (
                    <span className="text-sm text-[var(--color-ink-faint)]">{m['billing.store.perMonth']()}</span>
                )}
            </div>
            <p className="mt-1 font-semibold text-[var(--color-ink)]">{product.name}</p>
            {product.description && (
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{product.description}</p>
            )}

            <div className="my-4 h-px bg-[var(--color-border)]" />

            <dl className="space-y-2 text-sm">
                {specs.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between">
                        <dt className="text-[var(--color-ink-muted)]">{label}</dt>
                        <dd className="font-medium text-[var(--color-ink)]">{value}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-5 flex-1" />
            {blocked ? (
                <Button disabled className="w-full">
                    {m['billing.store.configure']()}
                </Button>
            ) : (
                <Link to={`/checkout/configure/${product.id}`}>
                    <Button className="w-full">
                        {m['billing.store.configure']()} <ArrowRight className="h-4 w-4" />
                    </Button>
                </Link>
            )}
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-2)]">
                <ShoppingBag className="h-6 w-6 text-[var(--color-ink-muted)]" />
            </div>
            <p className="max-w-sm text-sm text-[var(--color-ink-muted)]">{message}</p>
        </div>
    );
}
