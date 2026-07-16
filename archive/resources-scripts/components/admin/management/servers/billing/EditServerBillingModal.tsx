import { Server } from '@/api/routes/admin/server';
import updateServer, { Values } from '@/api/routes/admin/servers/updateServer';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import Input from '@/elements/Input';
import Label from '@/elements/Label';
import {
    CashIcon,
    CheckCircleIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ClockIcon,
    PencilAltIcon,
} from '@heroicons/react/outline';
import { useState, useEffect } from 'react';
import { getCategories } from '@/api/routes/admin/billing/categories';
import { Category, Product, BillingCycleWithPrice } from '@definitions/admin';
import Spinner from '@/elements/Spinner';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import http from '@/api/http';
import { Transformers } from '@definitions/admin';
import { getBillingCycles } from '@/api/routes/admin/billing/billingCycles';
import { Alert } from '@/elements/alert';

const MB_TO_GB = 1024;

interface BillingFormData {
    billable: boolean;
    categoryId: number | null;
    productId: number | null;
    billingDays: number | null;
    renewalDate: string;
}

const pages = [
    { title: '(1/3) Billing Status', description: 'Enable or disable automatic billing for this server.' },
    { title: '(2/3) Select Plan & Cycle', description: 'Choose the billing plan and billing cycle.' },
    { title: '(3/3) Renewal Date', description: 'Set when the server will next renew.' },
];

interface StepProps {
    form: BillingFormData;
    update: <K extends keyof BillingFormData>(key: K, value: BillingFormData[K]) => void;
    server: Server;
    categories: Category[];
    products: Product[];
    billingCycles: BillingCycleWithPrice[];
    loadingCategories: boolean;
    loadingProducts: boolean;
    loadingBillingCycles: boolean;
    onCategoryChange: (categoryId: number | null) => void;
    onProductChange: (productId: number | null) => void;
}

const BillingStatusStep = ({ form, update }: StepProps) => (
    <div className="mb-8 space-y-6">
        <div>
            <Label className="mb-3">
                <CashIcon className="inline-flex w-4" /> Billing Status
            </Label>
            <p className="mb-4 text-sm text-gray-400">
                Enable billing to automatically charge for this server. When disabled, the server will not be billed and
                renewal dates will be ignored.
            </p>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => update('billable', true)}
                    className={`flex-1 rounded-lg border-2 px-6 py-4 font-semibold transition-all ${
                        form.billable
                            ? 'border-green-500 bg-green-500/10 text-green-400'
                            : 'border-neutral-700 bg-neutral-800/50 text-gray-400 hover:border-neutral-600'
                    }`}
                >
                    <CashIcon className="mx-auto mb-2 w-8" />
                    <div>Enabled</div>
                    <p className="mt-1 text-xs font-normal opacity-75">Server will be billed automatically</p>
                </button>
                <button
                    type="button"
                    onClick={() => update('billable', false)}
                    className={`flex-1 rounded-lg border-2 px-6 py-4 font-semibold transition-all ${
                        !form.billable
                            ? 'border-red-500 bg-red-500/10 text-red-400'
                            : 'border-neutral-700 bg-neutral-800/50 text-gray-400 hover:border-neutral-600'
                    }`}
                >
                    <ClockIcon className="mx-auto mb-2 w-8" />
                    <div>Disabled</div>
                    <p className="mt-1 text-xs font-normal opacity-75">No automatic billing</p>
                </button>
            </div>
        </div>

        {!form.billable && (
            <Alert type="warning">
                When billing is disabled, the server will not renew automatically. Make sure to manage the server
                lifecycle manually.
            </Alert>
        )}
    </div>
);

const PlanSelectionStep = ({
    form,
    update,
    categories,
    products,
    billingCycles,
    loadingCategories,
    loadingProducts,
    loadingBillingCycles,
    onCategoryChange,
    onProductChange,
}: StepProps) => {
    const selectedCycle = billingCycles.find(c => c.days === form.billingDays);

    return (
        <div className="mb-8 space-y-6">
            {/* Category Selection */}
            <div>
                <Label className="mb-2">
                    <CashIcon className="inline-flex w-4" /> Billing Category
                </Label>
                <p className="mb-3 text-sm text-gray-400">Select the category that contains your billing plans.</p>
                {loadingCategories ? (
                    <div className="py-8 text-center">
                        <Spinner size="small" />
                    </div>
                ) : categories.length === 0 ? (
                    <Alert type="danger">No billing categories available. Please create a category first.</Alert>
                ) : (
                    <select
                        value={form.categoryId || ''}
                        onChange={e => {
                            const val = parseInt(e.target.value, 10);
                            const categoryId = !Number.isNaN(val) && val > 0 ? val : null;
                            update('categoryId', categoryId);
                            onCategoryChange(categoryId);
                        }}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm transition-colors hover:border-neutral-600 focus:border-blue-500 focus:outline-none"
                    >
                        <option value="">Select a category...</option>
                        {categories.map(category => (
                            <option key={category.id} value={category.id}>
                                {category.name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Product Selection */}
            {form.categoryId && (
                <div>
                    <Label className="mb-2">
                        <CashIcon className="inline-flex w-4" /> Billing Plan
                    </Label>
                    <p className="mb-3 text-sm text-gray-400">Choose which plan this server should be billed under.</p>
                    {loadingProducts ? (
                        <div className="py-8 text-center">
                            <Spinner size="small" />
                        </div>
                    ) : products.length === 0 ? (
                        <Alert type="danger">No products found in this category. Please create products first.</Alert>
                    ) : (
                        <>
                            <select
                                value={form.productId || ''}
                                onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    const productId = !Number.isNaN(val) && val > 0 ? val : null;
                                    update('productId', productId);
                                    onProductChange(productId);
                                }}
                                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm transition-colors hover:border-neutral-600 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="">Select a billing plan...</option>
                                {products.map(product => (
                                    <option key={product.id} value={product.id}>
                                        {product.name} ({product.limits.cpu}% CPU,{' '}
                                        {(product.limits.memory / MB_TO_GB).toFixed(1)}GB RAM,{' '}
                                        {(product.limits.disk / MB_TO_GB).toFixed(1)}GB Disk)
                                    </option>
                                ))}
                            </select>
                            {!form.productId && (
                                <p className="mt-2 text-sm text-yellow-400">Please select a billing plan to continue</p>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Billing Cycle Selection */}
            {form.productId && (
                <div>
                    <Label className="mb-2">
                        <ClockIcon className="inline-flex w-4" /> Billing Cycle
                    </Label>
                    <p className="mb-3 text-sm text-gray-400">How often should this server be billed?</p>
                    {loadingBillingCycles ? (
                        <div className="py-8 text-center">
                            <Spinner size="small" />
                        </div>
                    ) : billingCycles.length === 0 ? (
                        <Alert type="danger">
                            No billing cycles configured. Please configure billing cycles for this product.
                        </Alert>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {billingCycles.map(cycle => (
                                    <button
                                        key={cycle.id}
                                        type="button"
                                        onClick={() => update('billingDays', cycle.days)}
                                        className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                                            form.billingDays === cycle.days
                                                ? 'border-blue-500 bg-blue-500/10'
                                                : 'border-neutral-700 bg-neutral-800/50 hover:border-neutral-600'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="font-semibold">
                                                {cycle.days} {cycle.days === 1 ? 'Day' : 'Days'}
                                            </div>
                                            {cycle.isDefault && (
                                                <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                                                    Default
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1 text-lg font-bold">
                                            ${cycle.price?.toFixed(2) || '0.00'}
                                        </div>
                                        {cycle.discountPercent !== 0 && (
                                            <div
                                                className={`mt-1 text-xs ${
                                                    cycle.discountPercent > 0 ? 'text-green-400' : 'text-red-400'
                                                }`}
                                            >
                                                {cycle.discountPercent > 0 ? '' : '+'}
                                                {Math.abs(cycle.discountPercent)}%{' '}
                                                {cycle.discountPercent > 0 ? 'discount' : 'premium'}
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {selectedCycle && (
                                <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
                                    <div className="mb-2 flex items-center text-blue-400">
                                        <CheckCircleIcon className="mr-2 w-5" />
                                        <span className="font-semibold">Selected Billing Cycle</span>
                                    </div>
                                    <div className="grid gap-2 text-sm text-gray-300">
                                        <div className="flex justify-between">
                                            <span>Cycle Length:</span>
                                            <span className="font-semibold">
                                                {selectedCycle.days} {selectedCycle.days === 1 ? 'day' : 'days'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Price:</span>
                                            <span className="font-semibold">
                                                ${selectedCycle.price?.toFixed(2) || '0.00'}
                                            </span>
                                        </div>
                                        {selectedCycle.discountPercent !== 0 && (
                                            <div className="flex justify-between">
                                                <span>Discount:</span>
                                                <span
                                                    className={`font-semibold ${
                                                        selectedCycle.discountPercent > 0
                                                            ? 'text-green-400'
                                                            : 'text-red-400'
                                                    }`}
                                                >
                                                    {selectedCycle.discountPercent > 0 ? '' : '+'}
                                                    {Math.abs(selectedCycle.discountPercent)}%
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!form.billingDays && (
                                <p className="mt-2 text-sm text-yellow-400">
                                    Please select a billing cycle to continue
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const RenewalDateStep = ({ form, update }: StepProps) => (
    <div className="mb-8 space-y-6">
        <div>
            <Label className="mb-2">
                <ClockIcon className="inline-flex w-4" /> Renewal Date
            </Label>
            <p className="mb-3 text-sm text-gray-400">Set when this server will next renew and be charged.</p>
            <Input
                type="datetime-local"
                value={form.renewalDate}
                onChange={e => update('renewalDate', e.target.value)}
                className="w-full"
            />
            <p className="mt-2 text-sm text-gray-400">
                Server will next renew on:{' '}
                <span className="font-semibold text-white">{form.renewalDate.split('T')[0]}</span>
            </p>
        </div>

        <Alert type="info">
            The renewal date determines when the next billing cycle will begin. Make sure this date is accurate to avoid
            unexpected charges.
        </Alert>
    </div>
);

export default ({ server }: { server: Server }) => {
    const [open, setOpen] = useState<boolean>(false);
    const [page, setPage] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [billingCycles, setBillingCycles] = useState<BillingCycleWithPrice[]>([]);
    const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
    const [loadingProducts, setLoadingProducts] = useState<boolean>(false);
    const [loadingBillingCycles, setLoadingBillingCycles] = useState<boolean>(false);

    // Cache for billing cycles to avoid redundant API calls
    const [billingCyclesCache, setBillingCyclesCache] = useState<Map<number, BillingCycleWithPrice[]>>(new Map());

    const [form, setForm] = useState<BillingFormData>({
        billable: Boolean(server.billingProductId),
        categoryId: null,
        productId: null, // Let category auto-selection handle setting productId to ensure proper cascade
        billingDays: server.billingDays || null,
        renewalDate: server.renewalDate
            ? new Date(server.renewalDate).toISOString().slice(0, 16)
            : new Date().toISOString().slice(0, 16),
    });

    const update = <K extends keyof BillingFormData>(key: K, value: BillingFormData[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    // Helper function to select appropriate billing cycle from a list
    const selectBillingCycle = (cycles: BillingCycleWithPrice[]) => {
        if (cycles.length === 0) return;

        // If server already has billing_days, keep it selected if it exists in the cycles
        if (server.billingDays) {
            const hasCycle = cycles.some(c => c.days === server.billingDays);
            if (hasCycle) {
                setForm(prev => ({ ...prev, billingDays: server.billingDays ?? null }));
                return;
            }
        }

        // Select default cycle or first available
        const defaultCycle = cycles.find(c => c.isDefault);
        setForm(prev => ({
            ...prev,
            billingDays: defaultCycle ? defaultCycle.days : cycles[0]!.days,
        }));
    };

    // Load categories when dialog opens
    useEffect(() => {
        if (open) {
            setLoadingCategories(true);
            setError(null);
            getCategories()
                .then(cats => {
                    setCategories(cats);
                    if (cats.length === 0) {
                        setError('No billing categories found. Please create a category first.');
                        return;
                    }

                    // If server has a product, set the category from the product relationship
                    if (server.billingProductId && server.relationships?.product) {
                        const product = server.relationships.product;
                        // The product has a category relationship or categoryUuid
                        const category = product.relationships?.category;
                        if (category) {
                            // Use the category ID from the relationship
                            setForm(prev => ({ ...prev, categoryId: category.id }));
                        } else if (product.categoryUuid) {
                            // Fallback: find category by UUID in the loaded categories
                            const matchingCategory = cats.find(c => c.id === product.categoryUuid);
                            if (matchingCategory) {
                                setForm(prev => ({ ...prev, categoryId: matchingCategory.id }));
                            }
                        }
                    } else if (server.billingProductId && cats.length === 1) {
                        // Fallback: if there's only one category, use it
                        setForm(prev => ({ ...prev, categoryId: cats[0]!.id }));
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch categories:', err);
                    setError('Failed to load billing categories. Please try again.');
                })
                .finally(() => setLoadingCategories(false));
        }
    }, [open]);

    // Reset state when dialog closes
    useEffect(() => {
        if (!open) {
            setPage(0);
            setError(null);
            // Reset form to initial state
            setForm({
                billable: Boolean(server.billingProductId),
                categoryId: null,
                productId: null, // Let category auto-selection handle setting productId to ensure proper cascade
                billingDays: server.billingDays || null,
                renewalDate: server.renewalDate
                    ? new Date(server.renewalDate).toISOString().slice(0, 16)
                    : new Date().toISOString().slice(0, 16),
            });
            // Clear loaded data
            setProducts([]);
            setBillingCycles([]);
            // Don't clear cache - keep it for performance across modal reopens.
            // Cache persists during component lifecycle and is automatically cleared when component unmounts.
        }
    }, [open]);

    const handleCategoryChange = (categoryId: number | null) => {
        if (categoryId) {
            setLoadingProducts(true);
            setError(null);
            setProducts([]);

            http.get(`/api/application/billing/categories/${categoryId}/products`)
                .then(({ data }) => {
                    const productList = (data.data || []).map((item: any) => Transformers.toProduct(item));
                    setProducts(productList);
                    if (productList.length === 0) {
                        setError('No products found in this category. Please create products first.');
                    }
                    // If server has a product ID and it's in this list, keep it selected
                    if (server.billingProductId) {
                        const hasProduct = productList.some((p: Product) => p.id === server.billingProductId);
                        if (hasProduct) {
                            setForm(prev => ({ ...prev, productId: server.billingProductId ?? null }));
                        } else {
                            setForm(prev => ({ ...prev, productId: null }));
                        }
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch products:', err);
                    setError('Failed to load products for this category.');
                })
                .finally(() => setLoadingProducts(false));
        } else {
            setProducts([]);
            setForm(prev => ({ ...prev, productId: null }));
        }
    };

    const handleProductChange = (productId: number | null) => {
        if (form.categoryId && productId) {
            // Check cache first to avoid redundant API calls
            if (billingCyclesCache.has(productId)) {
                const cachedCycles = billingCyclesCache.get(productId)!;
                setBillingCycles(cachedCycles);
                selectBillingCycle(cachedCycles);
                return;
            }

            setLoadingBillingCycles(true);
            setError(null);
            setBillingCycles([]);

            getBillingCycles(form.categoryId, productId)
                .then(cycles => {
                    // Cache the results
                    setBillingCyclesCache(prev => new Map(prev).set(productId, cycles));
                    setBillingCycles(cycles);
                    if (cycles.length === 0) {
                        setError(
                            'No billing cycles configured for this product. Please configure billing cycles first.',
                        );
                    } else {
                        selectBillingCycle(cycles);
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch billing cycles:', err);
                    setError('Failed to load billing cycles for this product.');
                })
                .finally(() => setLoadingBillingCycles(false));
        } else {
            setBillingCycles([]);
            setForm(prev => ({ ...prev, billingDays: null }));
        }
    };

    // Load products when category is selected
    useEffect(() => {
        if (form.categoryId) {
            handleCategoryChange(form.categoryId);
        }
    }, [form.categoryId]);

    // Load billing cycles when product is selected
    useEffect(() => {
        if (form.productId) {
            handleProductChange(form.productId);
        }
    }, [form.productId]);

    const localStrToUTC = (localStr: string): Date => {
        const localDate = new Date(localStr);
        return new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000);
    };

    const canProceed = (): boolean => {
        if (page === 0) return true;
        if (page === 1) {
            if (!form.billable) return true; // Can skip if billing is disabled
            return Boolean(form.categoryId && form.productId && form.billingDays);
        }
        if (page === 2) {
            if (!form.billable) return true;
            return Boolean(form.renewalDate);
        }
        return false;
    };

    const submit = () => {
        const payload: Partial<Values> = {
            ...(server as unknown as Partial<Values>),
        };

        if (form.billable) {
            if (!form.renewalDate) {
                setError('Please select a renewal date');
                return;
            }
            if (!form.productId) {
                setError('Please select a billing plan');
                return;
            }
            if (!form.billingDays) {
                setError('Please select a billing cycle');
                return;
            }
            const utcDate = localStrToUTC(form.renewalDate);
            payload.renewalDate = utcDate;
            payload.billingProductId = form.productId;
            payload.billingDays = form.billingDays;
        } else {
            payload.renewalDate = null;
            payload.billingProductId = null;
            payload.billingDays = null;
        }

        setError(null);
        setLoading(true);

        updateServer(server.id, payload)
            .then(() => {
                setOpen(false);
                setPage(0);
                window.location.reload();
            })
            .catch(error => {
                console.error(error);
                setError(error.message || 'Failed to update billing settings');
            })
            .finally(() => setLoading(false));
    };

    const stepProps: StepProps = {
        form,
        update,
        server,
        categories,
        products,
        billingCycles,
        loadingCategories,
        loadingProducts,
        loadingBillingCycles,
        onCategoryChange: handleCategoryChange,
        onProductChange: handleProductChange,
    };

    return (
        <>
            <Dialog
                open={open}
                onClose={() => setOpen(false)}
                title={pages[page]!.title}
                description={pages[page]!.description}
                size="lg"
            >
                <SpinnerOverlay visible={loading} />

                {error && (
                    <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
                        {error}
                    </div>
                )}

                {page === 0 && <BillingStatusStep {...stepProps} />}
                {page === 1 && form.billable && <PlanSelectionStep {...stepProps} />}
                {page === 2 && form.billable && <RenewalDateStep {...stepProps} />}

                {/* Show confirmation for disabled billing */}
                {page > 0 && !form.billable && (
                    <div className="mb-8">
                        <Alert type="warning">
                            Billing is disabled. Click &quot;Finish&quot; to save these changes and disable automatic
                            billing for this server.
                        </Alert>
                    </div>
                )}

                <div className="absolute bottom-0 right-0 m-4 flex gap-2">
                    {page > 0 && (
                        <Button size={Button.Sizes.Large} onClick={() => setPage(page - 1)}>
                            <ChevronLeftIcon className="mr-1 h-5 w-5" />
                            Previous
                        </Button>
                    )}

                    {page < pages.length - 1 && (!form.billable || canProceed()) && (
                        <Button size={Button.Sizes.Large} onClick={() => setPage(page + 1)}>
                            Next
                            <ChevronRightIcon className="ml-1 h-5 w-5" />
                        </Button>
                    )}

                    {page === pages.length - 1 && (
                        <Button.Success size={Button.Sizes.Large} onClick={submit} disabled={!canProceed()}>
                            <CheckCircleIcon className="mr-1 h-5 w-5" /> Finish
                        </Button.Success>
                    )}
                </div>
            </Dialog>

            <Button size={Button.Sizes.Small} onClick={() => setOpen(true)}>
                Edit <PencilAltIcon className="ml-1 w-4" />
            </Button>
        </>
    );
};
