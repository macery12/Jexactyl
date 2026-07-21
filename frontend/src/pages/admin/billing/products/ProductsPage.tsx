import { m } from '@/i18n';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Boxes, Egg as EggIcon, Search } from 'lucide-react';
import { getCategories, deleteCategory, type BillingCategory } from '@/api/billingCategories';
import { getProducts } from '@/api/billingProducts';
import { getNestEggs } from '@/api/nests';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { useBilling } from '@/state/billing';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatePill } from './productChrome';

// Catalog landing page. Categories are the unit an admin actually manages, so
// they stay the top level — but each card now answers the questions the old flat
// list forced you to click through for: how many products, at what price range,
// and is any of it actually on sale to customers.

export default function ProductsPage() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const { money } = useBilling();
    const held = useAdminHeld();
    const [query, setQuery] = useState('');

    const { data: categories, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'categories'],
        queryFn: getCategories,
    });

    // Per-category product lists power the count + price range on each card.
    const productQueries = useQueries({
        queries: (categories ?? []).map(c => ({
            queryKey: ['admin', 'billing', 'products', c.id],
            queryFn: () => getProducts(c.id),
            staleTime: 60 * 1000,
        })),
    });

    // Resolve allowed-egg ids → names (one egg list per distinct nest).
    const nestIds = useMemo(
        () => [...new Set((categories ?? []).map(c => c.nestId).filter(Boolean))],
        [categories],
    );
    const eggQueries = useQueries({
        queries: nestIds.map(id => ({
            queryKey: ['admin', 'nest-eggs', id],
            queryFn: () => getNestEggs(id),
            staleTime: 5 * 60 * 1000,
        })),
    });
    const eggName = useMemo(() => {
        const map = new Map<number, string>();
        eggQueries.forEach(q => (q.data ?? []).forEach(e => map.set(e.id, e.name)));
        return map;
    }, [eggQueries]);

    const [delCat, setDelCat] = useState<BillingCategory | null>(null);

    const deleteCatMutation = useMutation({
        mutationFn: (id: number) => deleteCategory(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'categories'] });
            push({ type: 'success', message: m['admin.billing.categories.deleted']() });
            setDelCat(null);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const canCreateCat = can(held, 'billing.category-create');
    const canUpdateCat = can(held, 'billing.category-update');
    const canDeleteCat = can(held, 'billing.category-delete');

    // Search spans product names too, so "find the plan called X" doesn't mean
    // opening every category in turn.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return categories ?? [];
        return (categories ?? []).filter((c, i) => {
            if (c.name.toLowerCase().includes(q)) return true;
            if ((c.description ?? '').toLowerCase().includes(q)) return true;
            return (productQueries[i]?.data ?? []).some(p => p.name.toLowerCase().includes(q));
        });
    }, [categories, productQueries, query]);

    if (isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }
    if (isError || !categories) {
        return <p className="text-sm text-[var(--color-danger)]">{m['admin.billing.common.loadError']()}</p>;
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">
                        {m['admin.billing.products.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {m['admin.billing.products.subtitle']()}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                        <Input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={m['admin.billing.products.searchPlaceholder']()}
                            className="h-9 w-56 pl-9"
                        />
                    </div>
                    {canCreateCat && (
                        <Button size="sm" onClick={() => navigate('/admin/billing/products/categories/new')}>
                            <Plus className="h-4 w-4" /> {m['admin.billing.categories.new']()}
                        </Button>
                    )}
                </div>
            </div>

            {categories.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-12 text-center">
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.billing.categories.empty']()}</p>
                    {canCreateCat && (
                        <Button
                            size="sm"
                            className="mt-4"
                            onClick={() => navigate('/admin/billing/products/categories/new')}
                        >
                            <Plus className="h-4 w-4" /> {m['admin.billing.categories.new']()}
                        </Button>
                    )}
                </div>
            ) : visible.length === 0 ? (
                <p className="px-1 text-sm text-[var(--color-ink-faint)]">
                    {m['admin.billing.products.noMatches']({ query })}
                </p>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visible.map(cat => {
                        const index = categories.indexOf(cat);
                        const q = productQueries[index];
                        const products = q?.data ?? [];
                        const prices = products.map(p => p.price);
                        const hiddenCount = products.filter(p => !p.visible).length;

                        return (
                            <article
                                key={cat.id}
                                className="group flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] transition-colors hover:border-[var(--brand)]/40"
                            >
                                <button
                                    type="button"
                                    onClick={() => navigate(`/admin/billing/products/categories/${cat.id}`)}
                                    className="flex flex-1 flex-col gap-3 p-4 text-left"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h2 className="truncate font-medium text-[var(--color-ink)]">{cat.name}</h2>
                                            {cat.description && (
                                                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-ink-faint)]">
                                                    {cat.description}
                                                </p>
                                            )}
                                        </div>
                                        <StatePill
                                            on={cat.visible}
                                            onLabel={m['admin.billing.categories.shown']()}
                                            offLabel={m['admin.billing.categories.hidden']()}
                                        />
                                    </div>

                                    <div className="flex items-baseline gap-2">
                                        <span className="flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)]">
                                            <Boxes className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
                                            {q?.isLoading
                                                ? '—'
                                                : m['admin.billing.products.count']({ count: products.length })}
                                        </span>
                                        {prices.length > 0 && (
                                            <span className="ml-auto font-mono text-sm tabular-nums text-[var(--color-ink)]">
                                                {Math.min(...prices) === Math.max(...prices)
                                                    ? money(Math.min(...prices))
                                                    : `${money(Math.min(...prices))} – ${money(Math.max(...prices))}`}
                                            </span>
                                        )}
                                    </div>

                                    {hiddenCount > 0 && (
                                        <p className="text-[11px] text-[var(--color-warning)]">
                                            {m['admin.billing.products.hiddenCount']({ count: hiddenCount })}
                                        </p>
                                    )}

                                    <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                                        <EggIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                                        {cat.allowedEggs.slice(0, 3).map(id => (
                                            <span
                                                key={id}
                                                className={
                                                    'rounded-md px-2 py-0.5 text-[11px] font-medium ' +
                                                    (id === cat.eggId
                                                        ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-[var(--brand)]/30'
                                                        : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')
                                                }
                                            >
                                                {eggName.get(id) ?? m['admin.billing.categories.eggId']({ id })}
                                            </span>
                                        ))}
                                        {cat.allowedEggs.length > 3 && (
                                            <span className="text-[11px] text-[var(--color-ink-faint)]">
                                                +{cat.allowedEggs.length - 3}
                                            </span>
                                        )}
                                    </div>
                                </button>

                                <div className="flex items-center gap-1 border-t border-[var(--color-border)] px-2 py-1.5">
                                    {canUpdateCat && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['admin.billing.categories.edit']()}
                                            onClick={() => navigate(`/admin/billing/products/categories/${cat.id}`)}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                    {canDeleteCat && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="ml-auto"
                                            aria-label={m['admin.billing.categories.delete']()}
                                            onClick={() => setDelCat(cat)}
                                        >
                                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                                        </Button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            <ConfirmDialog
                open={Boolean(delCat)}
                onClose={() => setDelCat(null)}
                title={m['admin.billing.categories.deleteTitle']()}
                body={m['admin.billing.categories.deleteBody']({ name: delCat?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={deleteCatMutation.isPending}
                onConfirm={() => delCat && deleteCatMutation.mutate(delCat.id)}
            />
        </div>
    );
}
