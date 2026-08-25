import { m } from '@/i18n/messages';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Info,
    Gauge,
    SlidersHorizontal,
    CalendarClock,
    Tag,
    Copy,
    Cpu,
    MemoryStick,
    HardDrive,
    Archive,
    Database,
    Network,
    Globe,
} from 'lucide-react';
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
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { SectionCard, FieldRow, SaveBar, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { LimitField, ProductPreview } from './productChrome';
import { CycleEditor, type CycleDraft } from './CycleEditor';

interface FormShape {
    name: string;
    icon: string;
    price: number;
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

const NEW_DEFAULTS: FormShape = {
    name: '',
    icon: '',
    price: 0,
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
        getValues,
        setValue,
        reset,
        formState: { errors, isDirty },
    } = useForm<FormShape>({ defaultValues: NEW_DEFAULTS });

    const [cycles, setCycles] = useState<CycleDraft[]>([]);
    const [cyclesDirty, setCyclesDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [cloning, setCloning] = useState(false);

    // Seed the form + cycles once the product (and its cycles) load.
    useEffect(() => {
        if (!editing || !product) return;
        reset({
            name: product.name,
            icon: product.icon ?? '',
            price: product.price,
            description: product.description ?? '',
            visible: product.visible,
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

    // Watched per-field rather than a bare watch(): the pricing preview and the
    // limit inputs are controlled, so they need live values, but subscribing to
    // the whole form would re-render the page on every keystroke in any field.
    // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() opts out of the react compiler
    const visible = watch('visible');
    const price = watch('price');
    const name = watch('name');
    const description = watch('description');
    const cpu = watch('cpu');
    const memory = watch('memory');
    const disk = watch('disk');
    const backup = watch('backup');
    const database = watch('database');
    const allocation = watch('allocation');
    const subdomain = watch('subdomain');

    const dirty = isDirty || cyclesDirty;


    const mutateCycles = (next: CycleDraft[]) => {
        setCycles(next);
        setCyclesDirty(true);
    };

    const setLimit = (key: keyof FormShape) => (next: number) =>
        setValue(key, next as never, { shouldDirty: true });

    const buildPayload = (v: FormShape): ProductValues => ({
        name: v.name.trim(),
        icon: v.icon.trim() || null,
        price: Number(v.price) || 0,
        description: v.description.trim() || null,
        visible: v.visible,
        limits: {
            cpu: Number(v.cpu) || 0,
            memory: Number(v.memory) || 0,
            disk: Number(v.disk) || 0,
            backup: Number(v.backup) || 0,
            database: Number(v.database) || 0,
            allocation: Number(v.allocation) || 0,
            subdomain: Number(v.subdomain) || 0,
        },
    });

    const onSubmit = handleSubmit(async v => {
        if (categoryId == null || !category) {
            push({ type: 'error', message: m['admin.billing.products.noCategory']() });
            return;
        }
        const payload = buildPayload(v);
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
                reset(v);
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

    // Clone is done client-side — POST the current values under a new name and
    // copy the cycles across. No dedicated endpoint needed.
    const onClone = async () => {
        if (categoryId == null || !category || !product) return;
        setCloning(true);
        try {
            const current = getValues();
            const payload = buildPayload({
                ...current,
                name: m['admin.billing.products.copyOf']({ name: current.name }),
            });
            const created = await createProduct(categoryId, category.uuid, payload);
            const cyclePayload = cycles.filter(c => c.days > 0).map(c => ({ days: c.days, is_enabled: c.isEnabled }));
            if (cyclePayload.length > 0) {
                await syncBillingCycles(categoryId, created.id, cyclePayload);
            }
            qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
            push({ type: 'success', message: m['admin.billing.products.cloned']() });
            navigate(`/admin/billing/products/${created.id}?category=${categoryId}`);
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setCloning(false);
        }
    };

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
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <Link
                        to={backTo}
                        className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />{' '}
                        {category
                            ? m['admin.billing.products.backToCategory']({ name: category.name })
                            : m['admin.billing.products.backToCatalog']()}
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

                {editing && (
                    <div className="flex shrink-0 items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={onClone} disabled={cloning}>
                            {cloning ? <Spinner className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {m['admin.billing.products.clone']()}
                        </Button>
                    </div>
                )}
            </div>

            {/*
                Two columns rather than one stack: the left is what the customer GETS,
                the right is what the plan IS and what it costs. Resources lead because
                they're the part that actually defines a plan — a name and a price are
                the easy half, and burying the limits third made the page read as an
                undifferentiated wall of fields.
            */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
                <div className="flex min-w-0 flex-col gap-5">
                    <SectionCard
                        id="resources"
                        icon={Gauge}
                        title={m['admin.billing.products.section.resources']()}
                        desc={m['admin.billing.products.section.resourcesDesc']()}
                    >
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                            <LimitField
                                label={m['admin.billing.products.limit.cpu']()}
                                icon={Cpu}
                                unit="%"
                                hint={m['admin.billing.products.limitDesc.cpu']()}
                                value={cpu}
                                onChange={setLimit('cpu')}
                                unlimitable
                                presets={[50, 100, 200, 400, 0]}
                            />
                            <LimitField
                                label={m['admin.billing.products.limit.memory']()}
                                icon={MemoryStick}
                                unit="MiB"
                                hint={m['admin.billing.products.limitDesc.memory']()}
                                value={memory}
                                onChange={setLimit('memory')}
                                unlimitable
                                presets={[1024, 2048, 4096, 8192, 16384, 0]}
                            />
                            <LimitField
                                label={m['admin.billing.products.limit.disk']()}
                                icon={HardDrive}
                                unit="MiB"
                                hint={m['admin.billing.products.limitDesc.disk']()}
                                value={disk}
                                onChange={setLimit('disk')}
                                unlimitable
                                presets={[5120, 10240, 20480, 51200, 0]}
                            />
                        </div>
                    </SectionCard>

                    <SectionCard
                        id="features"
                        icon={SlidersHorizontal}
                        title={m['admin.billing.products.section.featureLimits']()}
                        desc={m['admin.billing.products.section.featureLimitsDesc']()}
                    >
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                            <LimitField
                                label={m['admin.billing.products.limit.backup']()}
                                icon={Archive}
                                hint={m['admin.billing.products.limitDesc.backup']()}
                                value={backup}
                                onChange={setLimit('backup')}
                                presets={[0, 1, 3, 7]}
                            />
                            <LimitField
                                label={m['admin.billing.products.limit.database']()}
                                icon={Database}
                                hint={m['admin.billing.products.limitDesc.database']()}
                                value={database}
                                onChange={setLimit('database')}
                                presets={[0, 1, 2, 5]}
                            />
                            <LimitField
                                label={m['admin.billing.products.limit.allocation']()}
                                icon={Network}
                                hint={m['admin.billing.products.limitDesc.allocation']()}
                                value={allocation}
                                onChange={setLimit('allocation')}
                                presets={[0, 1, 2, 4]}
                            />
                            <LimitField
                                label={m['admin.billing.products.limit.subdomain']()}
                                icon={Globe}
                                hint={m['admin.billing.products.limitDesc.subdomain']()}
                                value={subdomain}
                                onChange={setLimit('subdomain')}
                                presets={[0, 1, 2]}
                            />
                        </div>
                    </SectionCard>

                    {/*
                        Cycles live at the bottom of this column rather than in a
                        full-width row of their own: a full-width row can't start
                        until the taller column ends, which left a dead gap under
                        Feature limits the height of the storefront preview.
                    */}
                    <SectionCard
                        id="cycles"
                        icon={CalendarClock}
                        title={m['admin.billing.products.section.cycles']()}
                        desc={m['admin.billing.products.section.cyclesDesc']()}
                    >
                        <CycleEditor cycles={cycles} onChange={mutateCycles} price={price} />
                    </SectionCard>
                </div>

                {/*
                    self-start matters: a grid item stretches to the row height by
                    default, which silently makes `sticky` do nothing.
                */}
                <aside className="flex min-w-0 flex-col gap-5 self-start lg:sticky lg:top-6">
                    <SectionCard
                        id="details"
                        icon={Info}
                        title={m['admin.billing.products.section.details']()}
                        desc={m['admin.billing.products.section.detailsDesc']()}
                    >
                        <FieldRow
                            label={m['admin.billing.products.name']()}
                            error={errors.name && m['admin.billing.common.required']()}
                        >
                            <Input {...register('name', { required: true })} invalid={Boolean(errors.name)} />
                        </FieldRow>
                        <FieldRow
                            label={m['admin.billing.products.icon']()}
                            desc={m['admin.billing.products.iconDesc']()}
                        >
                            <Input {...register('icon')} placeholder="server" />
                        </FieldRow>
                        <FieldRow
                            label={m['admin.billing.products.description']()}
                            desc={m['admin.billing.products.descriptionDesc']()}
                        >
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

                    <SectionCard
                        id="pricing"
                        icon={Tag}
                        title={m['admin.billing.products.section.price']()}
                        desc={m['admin.billing.products.section.priceDesc']()}
                    >
                        <FieldRow
                            label={m['admin.billing.products.price']()}
                            desc={m['admin.billing.products.priceDesc']()}
                        >
                            <Input
                                type="number"
                                step="0.01"
                                min="0"
                                {...register('price', { valueAsNumber: true, min: 0 })}
                            />
                        </FieldRow>

                        <FieldRow
                            label={m['admin.billing.products.preview']()}
                            desc={m['admin.billing.products.previewDesc']()}
                        >
                            <ProductPreview
                                name={name}
                                price={price}
                                description={description}
                                cpu={cpu}
                                memory={memory}
                                disk={disk}
                            />
                        </FieldRow>
                    </SectionCard>
                </aside>
            </div>

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
