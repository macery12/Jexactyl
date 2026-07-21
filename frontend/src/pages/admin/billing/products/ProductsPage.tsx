import { m } from '@/i18n';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, EyeOff, ChevronRight, Egg as EggIcon } from 'lucide-react';
import { getCategories, deleteCategory, type BillingCategory } from '@/api/billingCategories';
import { getNestEggs } from '@/api/nests';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function ProductsPage() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const held = useAdminHeld();

    const { data: categories, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'categories'],
        queryFn: getCategories,
    });

    // Resolve allowed-egg ids → names (one egg list per distinct nest).
    const nestIds = useMemo(() => [...new Set((categories ?? []).map(c => c.nestId).filter(Boolean))], [categories]);
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
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.products.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.products.subtitle']()}</p>
                </div>
                {canCreateCat && (
                    <Button size="sm" onClick={() => navigate('/admin/billing/products/categories/new')}>
                        <Plus className="h-4 w-4" /> {m['admin.billing.categories.new']()}
                    </Button>
                )}
            </div>

            {categories.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-12 text-center">
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.billing.categories.empty']()}</p>
                </div>
            ) : (
                <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                    {categories.map(cat => (
                        <li
                            key={cat.id}
                            className="flex items-center gap-4 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/50"
                        >
                            <button
                                type="button"
                                onClick={() => navigate(`/admin/billing/products/categories/${cat.id}`)}
                                className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3 text-left"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2">
                                        <span className="truncate font-medium text-[var(--color-ink)]">{cat.name}</span>
                                        {!cat.visible && (
                                            <EyeOff className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" aria-label={m['admin.billing.categories.hidden']()} />
                                        )}
                                    </span>
                                    {cat.description && (
                                        <span className="block truncate text-xs text-[var(--color-ink-faint)]">{cat.description}</span>
                                    )}
                                </span>

                                <span className="hidden max-w-[45%] flex-wrap items-center gap-1.5 md:flex">
                                    <EggIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                                    {cat.allowedEggs.slice(0, 4).map(id => (
                                        <span
                                            key={id}
                                            className={
                                                'rounded-md px-2 py-0.5 text-xs font-medium ' +
                                                (id === cat.eggId
                                                    ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-[var(--brand)]/30'
                                                    : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')
                                            }
                                        >
                                            {eggName.get(id) ?? m['admin.billing.categories.eggId']({ id })}
                                        </span>
                                    ))}
                                    {cat.allowedEggs.length > 4 && (
                                        <span className="text-xs text-[var(--color-ink-faint)]">
                                            +{cat.allowedEggs.length - 4}
                                        </span>
                                    )}
                                </span>

                                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                            </button>

                            <span className="flex shrink-0 items-center gap-1 pr-2">
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
                                        aria-label={m['admin.billing.categories.delete']()}
                                        onClick={() => setDelCat(cat)}
                                    >
                                        <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                                    </Button>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
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
