import { m } from '@/i18n';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info, Gauge, SlidersHorizontal, CalendarClock, Plus, Trash2 } from 'lucide-react';
import { getCategory } from '@/api/billingCategories';
import {
    getProduct,
    getBillingCycles,
    createProduct,
    updateProduct,
    syncBillingCycles,
    type ProductValues,
} from '@/api/billingProducts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { SectionCard, FieldRow, SaveBar, ToggleGroup, ToggleRow } from '../editorChrome';

interface FormShape {
    name: string;
    icon: string;
    price: number;
    base_price: number;
    description: string;
    visible: boolean;
    cpu: number;
    memory: number;
    disk: number;
    backup: number;
    database: number;
    allocation: number;
    subdomain: number;
}

interface CycleDraft {
    id?: number;
    days: number;
    isEnabled: boolean;
}

const NEW_DEFAULTS: FormShape = {
    name: '',
    icon: '',
    price: 0,
    base_price: NaN,
    description: '',
    visible: true,
    cpu: 100,
    memory: 1024,
    disk: 4096,
    backup: 0,
    database: 0,
    allocation: 1,
    subdomain: 1,
};

export default function ProductEditorPage() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { push } = useFlashes();
    const { productId } = useParams<'productId'>();
    const [params] = useSearchParams();
    const categoryId = params.get('category');
    const editing = Boolean(productId);

    const { data: category } = useQuery({
        queryKey: ['admin', 'billing', 'category', categoryId],
        queryFn: () => getCategory(categoryId!),
        enabled: categoryId != null,
    });
    const { data: product, isLoading: loadingProduct } = useQuery({
        queryKey: ['admin', 'billing', 'product', categoryId, productId],
        queryFn: () => getProduct(categoryId!, productId!),
        enabled: editing && categoryId != null,
    });
    const { data: existingCycles } = useQuery({
        queryKey: ['admin', 'billing', 'cycles', categoryId, productId],
        queryFn: () => getBillingCycles(categoryId!, productId!),
        enabled: editing && categoryId != null,
    });

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors, isDirty },
    } = useForm<FormShape>({ defaultValues: NEW_DEFAULTS });

    const [cycles, setCycles] = useState<CycleDraft[]>([]);
    const [cyclesDirty, setCyclesDirty] = useState(false);
    const [saving, setSaving] = useState(false);

    // Seed the form + cycles once the product (and its cycles) load.
    useEffect(() => {
        if (!editing) return;
        if (!product) return;
        reset({
            name: product.name,
            icon: product.icon ?? '',
            price: product.price,
            base_price: product.basePrice ?? NaN,
            description: product.description ?? '',
            visible: true,
            cpu: product.limits.cpu,
            memory: product.limits.memory,
            disk: product.limits.disk,
            backup: product.limits.backup,
            database: product.limits.database,
            allocation: product.limits.allocation,
            subdomain: product.limits.subdomain,
        });
    }, [editing, product, reset]);

    useEffect(() => {
        if (existingCycles) {
            setCycles(existingCycles.map(c => ({ id: c.id, days: c.days, isEnabled: c.isEnabled })));
            setCyclesDirty(false);
        }
    }, [existingCycles]);

    const visible = watch('visible');
    const dirty = isDirty || cyclesDirty;

    const mutateCycles = (next: CycleDraft[]) => {
        setCycles(next);
        setCyclesDirty(true);
    };

    const onSubmit = handleSubmit(async values => {
        if (categoryId == null || !category) {
            push({ type: 'error', message: m['admin.billing.products.noCategory']() });
            return;
        }
        const payload: ProductValues = {
            name: values.name.trim(),
            icon: values.icon.trim() || null,
            price: Number(values.price) || 0,
            base_price: Number.isNaN(values.base_price) ? null : Number(values.base_price),
            description: values.description.trim() || null,
            visible: values.visible,
            limits: {
                cpu: Number(values.cpu) || 0,
                memory: Number(values.memory) || 0,
                disk: Number(values.disk) || 0,
                backup: Number(values.backup) || 0,
                database: Number(values.database) || 0,
                allocation: Number(values.allocation) || 0,
                subdomain: Number(values.subdomain) || 0,
            },
        };
        const cyclePayload = cycles
            .filter(c => c.days > 0)
            .map(c => ({ days: c.days, is_enabled: c.isEnabled }));

        setSaving(true);
        try {
            if (editing && product) {
                await updateProduct(categoryId, product.id, category.uuid, payload);
                await syncBillingCycles(categoryId, product.id, cyclePayload);
                qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
                push({ type: 'success', message: m['admin.billing.products.updated']() });
                setCyclesDirty(false);
                reset(values);
            } else {
                const created = await createProduct(categoryId, category.uuid, payload);
                if (cyclePayload.length > 0) {
                    await syncBillingCycles(categoryId, created.id, cyclePayload);
                }
                qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
                push({ type: 'success', message: m['admin.billing.products.created']() });
                navigate(`/admin/billing/products/${created.id}?category=${categoryId}`);
            }
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSaving(false);
        }
    });

    const backTo = categoryId != null ? `/admin/billing/products/categories/${categoryId}` : '/admin/billing/products';

    if (categoryId == null) {
        return (
            <div className="flex flex-col gap-4">
                <p className="text-sm text-[var(--color-danger)]">{m['admin.billing.products.noCategory']()}</p>
                <Link to="/admin/billing/products" className="text-sm text-[var(--brand)]">
                    {m['admin.billing.products.backToCatalog']()}
                </Link>
            </div>
        );
    }

    if (editing && loadingProduct) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <Link
                        to={backTo}
                        className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />{' '}
                        {category ? m['admin.billing.products.backToCategory']({ name: category.name }) : m['admin.billing.products.backToCatalog']()}
                    </Link>
                    <h1 className="mt-1 truncate text-xl font-semibold text-[var(--color-ink)]">
                        {editing ? product?.name : m['admin.billing.products.newTitle']()}
                    </h1>
                    {category && (
                        <p className="text-sm text-[var(--color-ink-muted)]">
                            {m['admin.billing.products.inCategory']({ name: category.name })}
                        </p>
                    )}
                </div>
            </div>

            <SectionCard id="details" icon={Info} title={m['admin.billing.products.section.details']()} desc={m['admin.billing.products.section.detailsDesc']()}>
                <FieldRow label={m['admin.billing.products.name']()} error={errors.name && m['admin.billing.common.required']()}>
                    <Input {...register('name', { required: true })} invalid={Boolean(errors.name)} />
                </FieldRow>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FieldRow label={m['admin.billing.products.price']()} desc={m['admin.billing.products.priceDesc']()}>
                        <Input type="number" step="0.01" min="0" {...register('price', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.products.basePrice']()} desc={m['admin.billing.products.basePriceDesc']()}>
                        <Input type="number" step="0.01" min="0" {...register('base_price', { valueAsNumber: true })} />
                    </FieldRow>
                </div>
                <FieldRow label={m['admin.billing.products.icon']()} desc={m['admin.billing.products.iconDesc']()}>
                    <Input {...register('icon')} placeholder="server" />
                </FieldRow>
                <FieldRow label={m['admin.billing.products.description']()} desc={m['admin.billing.products.descriptionDesc']()}>
                    <Input {...register('description')} />
                </FieldRow>
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.billing.products.visible']()}
                        desc={m['admin.billing.products.visibleDesc']()}
                        checked={visible}
                        onChange={v => setValue('visible', v, { shouldDirty: true })}
                    />
                </ToggleGroup>
            </SectionCard>

            <SectionCard id="resources" icon={Gauge} title={m['admin.billing.products.section.resources']()} desc={m['admin.billing.products.section.resourcesDesc']()}>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                    <FieldRow label={m['admin.billing.products.limit.cpu']()} mono="%" desc={m['admin.billing.products.limitDesc.cpu']()}>
                        <Input type="number" min="0" {...register('cpu', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.products.limit.memory']()} mono="MiB" desc={m['admin.billing.products.limitDesc.memory']()}>
                        <Input type="number" min="0" {...register('memory', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.products.limit.disk']()} mono="MiB" desc={m['admin.billing.products.limitDesc.disk']()}>
                        <Input type="number" min="0" {...register('disk', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                </div>
            </SectionCard>

            <SectionCard id="features" icon={SlidersHorizontal} title={m['admin.billing.products.section.featureLimits']()} desc={m['admin.billing.products.section.featureLimitsDesc']()}>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FieldRow label={m['admin.billing.products.limit.backup']()} desc={m['admin.billing.products.limitDesc.backup']()}>
                        <Input type="number" min="0" {...register('backup', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.products.limit.database']()} desc={m['admin.billing.products.limitDesc.database']()}>
                        <Input type="number" min="0" {...register('database', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.products.limit.allocation']()} desc={m['admin.billing.products.limitDesc.allocation']()}>
                        <Input type="number" min="0" {...register('allocation', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                    <FieldRow label={m['admin.billing.products.limit.subdomain']()} desc={m['admin.billing.products.limitDesc.subdomain']()}>
                        <Input type="number" min="0" {...register('subdomain', { valueAsNumber: true, min: 0 })} />
                    </FieldRow>
                </div>
            </SectionCard>

            <SectionCard id="cycles" icon={CalendarClock} title={m['admin.billing.products.section.cycles']()} desc={m['admin.billing.products.section.cyclesDesc']()}>
                {cycles.length === 0 && (
                    <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.billing.cycles.empty']()}</p>
                )}
                <div className="flex flex-col gap-2">
                    {cycles.map((c, i) => (
                        <div key={c.id ?? `new-${i}`} className="flex items-center gap-3">
                            <Input
                                type="number"
                                min="1"
                                max="365"
                                value={Number.isNaN(c.days) ? '' : c.days}
                                onChange={e =>
                                    mutateCycles(cycles.map((x, xi) => (xi === i ? { ...x, days: Number(e.target.value) } : x)))
                                }
                                className="w-28"
                                aria-label={m['admin.billing.cycles.days']()}
                            />
                            <span className="text-sm text-[var(--color-ink-muted)]">{m['admin.billing.cycles.days']()}</span>
                            <label className="ml-2 flex items-center gap-2 text-sm text-[var(--color-ink)]">
                                <Switch
                                    checked={c.isEnabled}
                                    onChange={v => mutateCycles(cycles.map((x, xi) => (xi === i ? { ...x, isEnabled: v } : x)))}
                                />
                                {m['admin.billing.cycles.enabled']()}
                            </label>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="ml-auto"
                                aria-label={m['admin.billing.cycles.remove']()}
                                onClick={() => mutateCycles(cycles.filter((_, xi) => xi !== i))}
                            >
                                <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                            </Button>
                        </div>
                    ))}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => mutateCycles([...cycles, { days: 30, isEnabled: true }])}
                >
                    <Plus className="h-4 w-4" /> {m['admin.billing.cycles.add']()}
                </Button>
            </SectionCard>

            <SaveBar
                dirty={dirty}
                saving={saving}
                onDiscard={() => {
                    if (editing && product) {
                        reset();
                        setCycles((existingCycles ?? []).map(c => ({ id: c.id, days: c.days, isEnabled: c.isEnabled })));
                    } else {
                        reset(NEW_DEFAULTS);
                        setCycles([]);
                    }
                    setCyclesDirty(false);
                }}
            />
        </form>
    );
}
