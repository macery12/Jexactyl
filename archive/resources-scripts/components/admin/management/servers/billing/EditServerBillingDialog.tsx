import { Server } from '@/api/routes/admin/server';
import updateServer, { Values } from '@/api/routes/admin/servers/updateServer';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import Input from '@/elements/Input';
import Label from '@/elements/Label';
import { CashIcon, ClockIcon, PencilAltIcon } from '@heroicons/react/outline';
import classNames from 'classnames';
import { Form, Formik } from 'formik';
import { useState, useEffect } from 'react';
import { getCategories } from '@/api/routes/admin/billing/categories';
import { Category, Product, BillingCycleWithPrice } from '@definitions/admin';
import Spinner from '@/elements/Spinner';
import http from '@/api/http';
import { Transformers } from '@definitions/admin';
import { getBillingCycles } from '@/api/routes/admin/billing/billingCycles';

const MB_TO_GB = 1024;

export default ({ server }: { server: Server }) => {
    const [open, setOpen] = useState<boolean>(false);
    const [billable, setBillable] = useState<boolean>(Boolean(server.billingProductId));
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [selectedProductId, setSelectedProductId] = useState<number | null>(server.billingProductId || null);
    const [selectedBillingDays, setSelectedBillingDays] = useState<number | null>(server.billingDays || null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [billingCycles, setBillingCycles] = useState<BillingCycleWithPrice[]>([]);
    const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
    const [loadingProducts, setLoadingProducts] = useState<boolean>(false);
    const [loadingBillingCycles, setLoadingBillingCycles] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [renewalDateStr, setRenewalDateStr] = useState<string>(
        server.renewalDate
            ? new Date(server.renewalDate).toISOString().slice(0, 16)
            : new Date().toISOString().slice(0, 16),
    );

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
                    }

                    // If server has a product, try to find its category
                    if (server.billingProductId && server.relationships.product) {
                        // We need to find which category this product belongs to
                        // For now, if there's only one category, select it
                        if (cats.length === 1) {
                            setSelectedCategoryId(cats[0]!.id);
                        }
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch categories:', err);
                    setError('Failed to load billing categories. Please try again.');
                })
                .finally(() => setLoadingCategories(false));
        }
    }, [open]);

    // Load products when category is selected
    useEffect(() => {
        if (selectedCategoryId) {
            setLoadingProducts(true);
            setError(null);
            setProducts([]);

            // Don't reset selectedProductId if we're loading the current server's category
            if (!server.billingProductId) {
                setSelectedProductId(null);
            }

            // Fetch products directly from the products endpoint
            http.get(`/api/application/billing/categories/${selectedCategoryId}/products`)
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
                            setSelectedProductId(server.billingProductId);
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
            if (!server.billingProductId) {
                setSelectedProductId(null);
            }
        }
    }, [selectedCategoryId]);

    // Load billing cycles when product is selected
    useEffect(() => {
        if (selectedCategoryId && selectedProductId) {
            setLoadingBillingCycles(true);
            setError(null);
            setBillingCycles([]);

            getBillingCycles(selectedCategoryId, selectedProductId)
                .then(cycles => {
                    setBillingCycles(cycles);
                    if (cycles.length === 0) {
                        setError(
                            'No billing cycles configured for this product. Please configure billing cycles first.',
                        );
                    } else {
                        // If server already has billing_days, keep it selected if it exists in the cycles
                        if (server.billingDays) {
                            const hasCycle = cycles.some(c => c.days === server.billingDays);
                            if (hasCycle) {
                                setSelectedBillingDays(server.billingDays);
                            } else {
                                // Select default cycle
                                const defaultCycle = cycles.find(c => c.isDefault);
                                setSelectedBillingDays(defaultCycle ? defaultCycle.days : cycles[0]!.days);
                            }
                        } else {
                            // Select default cycle
                            const defaultCycle = cycles.find(c => c.isDefault);
                            setSelectedBillingDays(defaultCycle ? defaultCycle.days : cycles[0]!.days);
                        }
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch billing cycles:', err);
                    setError('Failed to load billing cycles for this product.');
                })
                .finally(() => setLoadingBillingCycles(false));
        } else {
            setBillingCycles([]);
            if (!server.billingDays) {
                setSelectedBillingDays(null);
            }
        }
    }, [selectedCategoryId, selectedProductId]);

    const localStrToUTC = (localStr: string): Date => {
        const localDate = new Date(localStr);
        return new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000);
    };

    const selectedCycle = billingCycles.find(c => c.days === selectedBillingDays);

    const submit = () => {
        const payload: Partial<Values> = {
            ...(server as unknown as Partial<Values>),
        };

        if (billable) {
            // When enabling billing, set the renewal date, product ID, and billing days
            if (!renewalDateStr) {
                setError('Please select a renewal date');
                return;
            }
            if (!selectedProductId) {
                setError('Please select a billing plan');
                return;
            }
            if (!selectedBillingDays) {
                setError('Please select a billing cycle');
                return;
            }
            const utcDate = localStrToUTC(renewalDateStr);
            payload.renewalDate = utcDate;
            payload.billingProductId = selectedProductId;
            payload.billingDays = selectedBillingDays;
        } else {
            // When disabling billing, clear the renewal date, product ID, and billing days
            payload.renewalDate = null;
            payload.billingProductId = null;
            payload.billingDays = null;
        }

        setError(null);
        updateServer(server.id, payload)
            .then(() => {
                window.location.reload();
            })
            .catch(error => {
                console.error(error);
                setError(error.message || 'Failed to update billing settings');
            });
    };

    return (
        <>
            <Dialog open={open} onClose={() => setOpen(false)} title={'Edit Server Billing'}>
                <Formik onSubmit={submit} initialValues={{}}>
                    <Form>
                        {error && (
                            <div
                                className={
                                    'mb-4 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400'
                                }
                            >
                                {error}
                            </div>
                        )}
                        <div className={'grid space-y-6'}>
                            <div>
                                <div className={'flex'}>
                                    <Label>
                                        <CashIcon className={'inline-flex w-4'} /> Billing Status
                                    </Label>
                                    <span className={'ml-2 text-sm italic text-gray-400'}>
                                        Should this server be billed automatically?
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setBillable(true)}
                                    className={classNames(
                                        billable ? 'bg-black/50' : 'bg-black/25',
                                        'rounded-l py-3 px-6 font-bold text-white',
                                    )}
                                >
                                    Enabled
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBillable(false)}
                                    className={classNames(
                                        !billable ? 'bg-black/50' : 'bg-black/25',
                                        'rounded-r py-3 px-6 font-bold text-white',
                                    )}
                                >
                                    Disabled
                                </button>
                            </div>

                            {billable && (
                                <>
                                    <div>
                                        <div className={'flex'}>
                                            <Label>
                                                <CashIcon className={'inline-flex w-4'} /> Billing Category
                                            </Label>
                                            <span className={'ml-2 text-sm italic text-gray-400'}>
                                                Select the category for billing.
                                            </span>
                                        </div>
                                        {loadingCategories ? (
                                            <Spinner size={'small'} />
                                        ) : categories.length === 0 ? (
                                            <div
                                                className={
                                                    'rounded border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-400'
                                                }
                                            >
                                                No billing categories available. Please create a category first.
                                            </div>
                                        ) : (
                                            <select
                                                value={selectedCategoryId || ''}
                                                onChange={e => {
                                                    const val = parseInt(e.target.value, 10);
                                                    setSelectedCategoryId(!Number.isNaN(val) && val > 0 ? val : null);
                                                }}
                                                className={
                                                    'w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm'
                                                }
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

                                    {selectedCategoryId && (
                                        <div>
                                            <div className={'flex'}>
                                                <Label>
                                                    <CashIcon className={'inline-flex w-4'} /> Billing Plan
                                                </Label>
                                                <span className={'ml-2 text-sm italic text-gray-400'}>
                                                    Select the billing product for this server.
                                                </span>
                                            </div>
                                            {loadingProducts ? (
                                                <Spinner size={'small'} />
                                            ) : products.length === 0 ? (
                                                <div
                                                    className={
                                                        'rounded border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-400'
                                                    }
                                                >
                                                    No products found in this category. Please create products first.
                                                </div>
                                            ) : (
                                                <select
                                                    value={selectedProductId || ''}
                                                    onChange={e => {
                                                        const val = parseInt(e.target.value, 10);
                                                        setSelectedProductId(
                                                            !Number.isNaN(val) && val > 0 ? val : null,
                                                        );
                                                    }}
                                                    className={
                                                        'w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm'
                                                    }
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
                                            )}
                                            {billable && !selectedProductId && products.length > 0 && (
                                                <p className={'mt-1 text-sm text-red-400'}>
                                                    Please select a billing plan to enable billing
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {selectedProductId && (
                                        <div>
                                            <div className={'flex'}>
                                                <Label>
                                                    <ClockIcon className={'inline-flex w-4'} /> Billing Cycle
                                                </Label>
                                                <span className={'ml-2 text-sm italic text-gray-400'}>
                                                    How often should this server be billed?
                                                </span>
                                            </div>
                                            {loadingBillingCycles ? (
                                                <Spinner size={'small'} />
                                            ) : billingCycles.length === 0 ? (
                                                <div
                                                    className={
                                                        'rounded border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-400'
                                                    }
                                                >
                                                    No billing cycles configured. Please configure billing cycles for
                                                    this product.
                                                </div>
                                            ) : (
                                                <>
                                                    <select
                                                        value={selectedBillingDays || ''}
                                                        onChange={e => {
                                                            const val = parseInt(e.target.value, 10);
                                                            setSelectedBillingDays(
                                                                !Number.isNaN(val) && val > 0 ? val : null,
                                                            );
                                                        }}
                                                        className={
                                                            'w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm'
                                                        }
                                                    >
                                                        <option value="">Select a billing cycle...</option>
                                                        {billingCycles.map(cycle => (
                                                            <option key={cycle.id} value={cycle.days}>
                                                                {cycle.days} days - ${cycle.price?.toFixed(2) || '0.00'}
                                                                {cycle.discountPercent !== 0 && (
                                                                    <>
                                                                        {' '}
                                                                        ({cycle.discountPercent > 0 ? '+' : ''}
                                                                        {cycle.discountPercent}%)
                                                                    </>
                                                                )}
                                                                {cycle.isDefault && ' (Default)'}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {selectedCycle && (
                                                        <div
                                                            className={
                                                                'mt-2 rounded border border-neutral-700 bg-neutral-800/50 p-3 text-sm'
                                                            }
                                                        >
                                                            <p className={'text-gray-300'}>
                                                                <strong>Selected Cycle:</strong> {selectedCycle.days}{' '}
                                                                days
                                                            </p>
                                                            <p className={'text-gray-300'}>
                                                                <strong>Price:</strong> $
                                                                {selectedCycle.price?.toFixed(2) || '0.00'}
                                                                {selectedCycle.discountPercent !== 0 && (
                                                                    <span
                                                                        className={
                                                                            selectedCycle.discountPercent > 0
                                                                                ? 'text-green-400'
                                                                                : 'text-red-400'
                                                                        }
                                                                    >
                                                                        {' '}
                                                                        ({selectedCycle.discountPercent > 0 ? '' : '+'}
                                                                        {Math.abs(selectedCycle.discountPercent)}%{' '}
                                                                        {selectedCycle.discountPercent > 0
                                                                            ? 'discount'
                                                                            : 'premium'}
                                                                        )
                                                                    </span>
                                                                )}
                                                            </p>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            {billable && !selectedBillingDays && billingCycles.length > 0 && (
                                                <p className={'mt-1 text-sm text-red-400'}>
                                                    Please select a billing cycle
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            <div>
                                <div className={'flex'}>
                                    <Label>
                                        <ClockIcon className={'inline-flex w-4'} /> Renewal Date
                                    </Label>
                                    <span className={'ml-2 text-sm italic text-gray-400'}>
                                        Adjust when this server will renew.
                                    </span>
                                </div>
                                <Input
                                    type="datetime-local"
                                    value={renewalDateStr}
                                    onChange={e => setRenewalDateStr(e.target.value)}
                                />
                                <p>Server will be set to next renew on: {renewalDateStr.split('T')[0]}</p>
                            </div>

                            <div className={'ml-auto'}>
                                <Button type="button" onClick={submit}>
                                    Save Changes
                                </Button>
                            </div>
                        </div>
                    </Form>
                </Formik>
            </Dialog>

            <Button size={Button.Sizes.Small} onClick={() => setOpen(true)}>
                Edit <PencilAltIcon className={'ml-1 w-4'} />
            </Button>
        </>
    );
};
