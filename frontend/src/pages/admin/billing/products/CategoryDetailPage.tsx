import { m } from '@/i18n/messages';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Settings2,
    Egg as EggIcon,
    Boxes,
    Plus,
    Pencil,
    Trash2,
    Star,
    Cpu,
    MemoryStick,
    HardDrive,
} from 'lucide-react';
import {
    getCategory,
    createCategory,
    updateCategory,
    type BillingCategory,
    type CategoryValues,
} from '@/api/billingCategories';
import { getNests, getNestEggs } from '@/api/nests';
import { getProducts, deleteProduct, type BillingProduct } from '@/api/billingProducts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useBilling } from '@/state/billing';
import { formatMib } from '@/lib/format';
import { cn } from '@/lib/cn';
import { SectionCard, FieldRow, SaveBar, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { StatePill } from './productChrome';

interface FormState {
    name: string;
    icon: string;
    description: string;
    visible: boolean;
    nestId: number | null;
    eggId: number | null;
    allowedEggs: number[];
    allowEggChanges: boolean;
    allowPlanChanges: boolean;
}

const NEW_STATE: FormState = {
    name: '',
    icon: '',
    description: '',
    visible: true,
    nestId: null,
    eggId: null,
    allowedEggs: [],
    allowEggChanges: true,
    allowPlanChanges: true,
};

function fromCategory(c: BillingCategory): FormState {
    return {
        name: c.name,
        icon: c.icon ?? '',
        description: c.description ?? '',
        visible: c.visible,
        nestId: c.nestId,
        eggId: c.eggId,
        allowedEggs: c.allowedEggs,
        allowEggChanges: c.allowEggChanges,
        allowPlanChanges: c.allowPlanChanges,
    };
}

// Loader wrapper — like V1's CategoryContainer, it waits for the category to
// load and only then mounts the form, so the form's state initializes straight
// from the real data (no effect-based seeding races on refresh).
export default function CategoryDetailPage() {
    const { categoryId } = useParams<'categoryId'>();
    const editing = categoryId != null;

    const { data: category, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'category', categoryId],
        queryFn: () => getCategory(categoryId!),
        enabled: editing,
    });

    if (editing && isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    if (editing && (isError || !category)) {
        return (
            <div className="flex flex-col gap-4">
                <p className="text-sm text-[var(--color-danger)]">{m['admin.billing.common.loadError']()}</p>
                <Link to="/admin/billing/products" className="text-sm text-[var(--brand)]">
                    {m['admin.billing.products.backToCatalog']()}
                </Link>
            </div>
        );
    }

    return (
        <CategoryForm
            key={category?.id ?? 'new'}
            category={category ?? null}
            initial={category ? fromCategory(category) : NEW_STATE}
        />
    );
}

function CategoryForm({ category, initial }: { category: BillingCategory | null; initial: FormState }) {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const held = useAdminHeld();
    const editing = category != null;

    const [form, setForm] = useState<FormState>(initial);
    const [seed, setSeed] = useState<FormState>(initial);
    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }));

    const { data: nests } = useQuery({ queryKey: ['admin', 'nests'], queryFn: getNests });
    const { data: eggs } = useQuery({
        queryKey: ['admin', 'nest-eggs', form.nestId],
        queryFn: () => getNestEggs(form.nestId!),
        enabled: form.nestId != null && form.nestId > 0,
        staleTime: 5 * 60 * 1000,
    });

    const nestOptions = useMemo(() => (nests ?? []).map(n => ({ value: String(n.id), label: n.name })), [nests]);

    const dirty = JSON.stringify(form) !== JSON.stringify(seed);

    const canCreate = can(held, 'billing.categories-create');
    const canUpdate = can(held, 'billing.categories-update');
    const canEditProduct = can(held, 'billing.products-update');
    const canCreateProduct = can(held, 'billing.products-create');
    const canDeleteProduct = can(held, 'billing.products-delete');

    // The first blocker, in the order the form asks for things. Surfacing this
    // is what makes the new-category flow work: a category can't be saved
    // without a primary egg, and the egg picker only appears once a nest is
    // chosen, so an admin who fills in just a name used to hit a Save button
    // that looked live and did nothing at all.
    const blockedReason =
        !(editing ? canUpdate : canCreate)
            ? m['admin.billing.categories.blocked.permission']()
            : form.name.trim().length < 3
              ? m['admin.billing.categories.blocked.name']()
              : form.nestId == null
                ? m['admin.billing.categories.blocked.nest']()
                : form.allowedEggs.length === 0 || form.eggId == null
                  ? m['admin.billing.categories.blocked.egg']()
                  : null;

    const canSubmit = blockedReason == null && dirty;

    const saveMutation = useMutation({
        mutationFn: async (values: CategoryValues) => {
            if (editing) {
                await updateCategory(category!.id, values);
                return category!.id;
            }
            const created = await createCategory(values);
            return created.id;
        },
        onSuccess: id => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'categories'] });
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'category', String(id)] });
            push({ type: 'success', message: editing ? m['admin.billing.categories.updated']() : m['admin.billing.categories.created']() });
            if (!editing) navigate(`/admin/billing/products/categories/${id}`);
            else setSeed(form);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (form.eggId == null || !canSubmit) return;
        const allowed = Array.from(new Set([form.eggId, ...form.allowedEggs]));
        saveMutation.mutate({
            name: form.name.trim(),
            icon: form.icon.trim() || null,
            description: form.description.trim() || null,
            visible: form.visible,
            eggId: form.eggId,
            allowedEggs: allowed,
            allowEggChanges: form.allowEggChanges,
            allowPlanChanges: form.allowPlanChanges,
        });
    };

    // Toggle an egg in/out of the allowed set; keep a sane primary.
    const toggleEgg = (id: number) =>
        setForm(f => {
            const has = f.allowedEggs.includes(id);
            const allowedEggs = has ? f.allowedEggs.filter(e => e !== id) : [...f.allowedEggs, id];
            let eggId = f.eggId;
            if (has && eggId === id) eggId = allowedEggs[0] ?? null;
            if (!has && eggId == null) eggId = id;
            return { ...f, allowedEggs, eggId };
        });

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="min-w-0">
                <Link
                    to="/admin/billing/products"
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                    <ArrowLeft className="h-3.5 w-3.5" /> {m['admin.billing.products.backToCatalog']()}
                </Link>
                <h1 className="mt-1 truncate text-xl font-semibold text-[var(--color-ink)]">
                    {editing ? form.name || category?.name : m['admin.billing.categories.newTitle']()}
                </h1>
            </div>

            {/*
                Settings and the egg picker share one row so the product list below can
                have the full page width — on a category you're editing, the products
                are the thing you came for, not the name field.
            */}
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                <SectionCard icon={Settings2} title={m['admin.billing.categories.section.settings']()} desc={m['admin.billing.categories.section.settingsDesc']()}>
                    <FieldRow label={m['admin.billing.categories.name']()}>
                        <Input value={form.name} onChange={e => set('name', e.target.value)} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.categories.icon']()} desc={m['admin.billing.categories.iconDesc']()}>
                        <Input value={form.icon} onChange={e => set('icon', e.target.value)} placeholder="server" />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.categories.description']()}>
                        <Input value={form.description} onChange={e => set('description', e.target.value)} />
                    </FieldRow>

                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium text-[var(--color-ink-muted)]">{m['admin.billing.categories.options']()}</p>
                        <ToggleGroup>
                            <ToggleRow
                                label={m['admin.billing.categories.visible']()}
                                desc={m['admin.billing.categories.visibleDesc']()}
                                checked={form.visible}
                                onChange={v => set('visible', v)}
                            />
                            <ToggleRow
                                label={m['admin.billing.categories.allowEggChanges']()}
                                desc={m['admin.billing.categories.allowEggChangesDesc']()}
                                checked={form.allowEggChanges}
                                onChange={v => set('allowEggChanges', v)}
                            />
                            <ToggleRow
                                label={m['admin.billing.categories.allowPlanChanges']()}
                                desc={m['admin.billing.categories.allowPlanChangesDesc']()}
                                checked={form.allowPlanChanges}
                                onChange={v => set('allowPlanChanges', v)}
                            />
                        </ToggleGroup>
                    </div>
                </SectionCard>

                <SectionCard
                    icon={EggIcon}
                    title={m['admin.billing.categories.section.eggs']()}
                    desc={m['admin.billing.categories.section.eggsDesc']()}
                    right={
                        <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['admin.billing.categories.eggsSelected']({ count: form.allowedEggs.length })}
                        </span>
                    }
                >
                    <FieldRow label={m['admin.billing.categories.nest']()} desc={m['admin.billing.categories.nestDesc']()}>
                        <Select
                            value={form.nestId != null ? String(form.nestId) : undefined}
                            onChange={v => {
                                const n = Number(v);
                                setForm(f => ({ ...f, nestId: Number.isFinite(n) && n > 0 ? n : null, eggId: null, allowedEggs: [] }));
                            }}
                            options={nestOptions}
                            placeholder={m['admin.billing.categories.selectNest']()}
                        />
                    </FieldRow>

                    {form.nestId == null ? (
                        <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.billing.categories.pickNestFirst']()}</p>
                    ) : !eggs ? (
                        <div className="flex justify-center py-4">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : (
                        <FieldRow label={m['admin.billing.categories.allowedEggs']()} desc={m['admin.billing.categories.allowedEggsDesc']()}>
                            <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
                                {eggs.map(egg => {
                                    const allowed = form.allowedEggs.includes(egg.id);
                                    const primary = form.eggId === egg.id;
                                    return (
                                        <div
                                            key={egg.id}
                                            role="checkbox"
                                            aria-checked={allowed}
                                            tabIndex={0}
                                            onClick={() => toggleEgg(egg.id)}
                                            onKeyDown={e => {
                                                if (e.key === ' ' || e.key === 'Enter') {
                                                    e.preventDefault();
                                                    toggleEgg(egg.id);
                                                }
                                            }}
                                            className={cn(
                                                'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60',
                                                allowed
                                                    ? 'border-[var(--brand)]/40 bg-[var(--brand)]/5 hover:bg-[var(--brand)]/10'
                                                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]/70',
                                            )}
                                        >
                                            <input
                                                type="checkbox"
                                                className="pointer-events-none accent-[var(--color-accent)]"
                                                checked={allowed}
                                                readOnly
                                                tabIndex={-1}
                                                aria-hidden
                                            />
                                            <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">{egg.name}</span>
                                            <button
                                                type="button"
                                                disabled={!allowed}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    set('eggId', egg.id);
                                                }}
                                                title={m['admin.billing.categories.makePrimary']()}
                                                className={cn(
                                                    'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-30',
                                                    primary
                                                        ? 'text-[var(--brand)]'
                                                        : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]',
                                                )}
                                            >
                                                <Star className={cn('h-3.5 w-3.5', primary && 'fill-[var(--brand)]')} />
                                                {primary ? m['admin.billing.categories.primary']() : ''}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </FieldRow>
                    )}
                </SectionCard>
            </div>

            {editing && category && (
                <ProductsSection
                    categoryId={category.id}
                    canCreate={canCreateProduct}
                    canEdit={canEditProduct}
                    canDelete={canDeleteProduct}
                />
            )}

            {!editing && (
                <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-5 py-4 text-sm text-[var(--color-ink-muted)]">
                    {m['admin.billing.categories.saveToAddProducts']()}
                </p>
            )}

            <SaveBar
                dirty={dirty}
                saving={saveMutation.isPending}
                onDiscard={() => setForm(seed)}
                blockedReason={blockedReason}
            />
        </form>
    );
}

// The category's products, rendered inline on its detail page.
function ProductsSection({
    categoryId,
    canCreate,
    canEdit,
    canDelete,
}: {
    categoryId: number;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
}) {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const { money } = useBilling();
    const [del, setDel] = useState<BillingProduct | null>(null);

    const { data: products, isLoading } = useQuery({
        queryKey: ['admin', 'billing', 'products', categoryId],
        queryFn: () => getProducts(categoryId),
    });

    const delMutation = useMutation({
        mutationFn: (productId: number) => deleteProduct(categoryId, productId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'products', categoryId] });
            push({ type: 'success', message: m['admin.billing.products.deleted']() });
            setDel(null);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    return (
        <SectionCard
            icon={Boxes}
            title={m['admin.billing.products.title']()}
            desc={m['admin.billing.products.sectionDesc']()}
            right={
                canCreate && (
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => navigate(`/admin/billing/products/new?category=${categoryId}`)}
                    >
                        <Plus className="h-4 w-4" /> {m['admin.billing.products.new']()}
                    </Button>
                )
            }
        >
            {isLoading ? (
                <div className="flex justify-center py-6">
                    <Spinner className="h-5 w-5" />
                </div>
            ) : !products || products.length === 0 ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-[var(--color-border-strong)] px-4 py-6">
                    <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.billing.products.empty']()}</p>
                    {canCreate && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/admin/billing/products/new?category=${categoryId}`)}
                        >
                            <Plus className="h-4 w-4" /> {m['admin.billing.products.new']()}
                        </Button>
                    )}
                </div>
            ) : (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {products.map(p => (
                        <li
                            key={p.id}
                            className="flex flex-col rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]"
                        >
                            <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => navigate(`/admin/billing/products/${p.id}?category=${categoryId}`)}
                                className="flex min-w-0 flex-1 flex-col items-start gap-2 p-4 text-left disabled:cursor-default"
                            >
                                <span className="flex w-full min-w-0 items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-ink)]">
                                        {p.name}
                                    </span>
                                    {!p.visible && (
                                        <StatePill
                                            on={false}
                                            onLabel={m['admin.billing.products.shown']()}
                                            offLabel={m['admin.billing.products.hidden']()}
                                        />
                                    )}
                                </span>

                                <span className="font-mono text-lg font-semibold tabular-nums text-[var(--brand-bright)]">
                                    {p.price === 0 ? m['admin.billing.products.free']() : money(p.price)}
                                </span>

                                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-[var(--color-ink-muted)]">
                                    <span className="flex items-center gap-1">
                                        <Cpu className="h-3.5 w-3.5" /> {p.limits.cpu || '∞'}%
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <MemoryStick className="h-3.5 w-3.5" /> {formatMib(p.limits.memory)}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <HardDrive className="h-3.5 w-3.5" /> {formatMib(p.limits.disk)}
                                    </span>
                                </span>
                            </button>

                            {(canEdit || canDelete) && (
                                <span className="flex items-center justify-end gap-1 border-t border-[var(--color-border)] px-2 py-1.5">
                                    {canEdit && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['admin.billing.products.edit']()}
                                            onClick={() =>
                                                navigate(`/admin/billing/products/${p.id}?category=${categoryId}`)
                                            }
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                    {canDelete && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={m['admin.billing.products.delete']()}
                                            onClick={() => setDel(p)}
                                        >
                                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                                        </Button>
                                    )}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <ConfirmDialog
                open={Boolean(del)}
                onClose={() => setDel(null)}
                title={m['admin.billing.products.deleteTitle']()}
                body={m['admin.billing.products.deleteBody']({ name: del?.name ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={delMutation.isPending}
                onConfirm={() => del && delMutation.mutate(del.id)}
            />
        </SectionCard>
    );
}
