import type { Actions } from 'easy-peasy';
import { useStoreActions } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Form, Formik } from 'formik';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Field, { FieldRow } from '@/elements/Field';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import type { ApplicationStore } from '@/state';
import AdminBox from '@/elements/AdminBox';
import { object, string, number } from 'yup';
import {
    faArrowLeft,
    faBell,
    faMicrochip,
    faPuzzlePiece,
    faCalendarAlt,
    faDollarSign,
} from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import { createProduct, updateProduct } from '@/api/routes/admin/billing/products';
import ProductDeleteButton from './ProductDeleteButton';
import BillingCyclesManager from './BillingCyclesManager';
import { CubeIcon } from '@heroicons/react/outline';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { getCategory } from '@/api/routes/admin/billing/categories';
import { Product } from '@definitions/admin';
import { ProductValues } from '@/api/routes/admin/billing/types';
import { Alert } from '@/elements/alert';
import { getBillingCycles, syncBillingCycles } from '@/api/routes/admin/billing/billingCycles';

export default ({ product }: { product?: Product }) => {
    const navigate = useNavigate();
    const params = useParams<'id'>();
    const [uuid, setUuid] = useState<string>();
    const [billingCycles, setBillingCycles] = useState<Array<{ id?: number; days: number; isEnabled: boolean }>>([]);

    const { clearFlashes, clearAndAddHttpError } = useStoreActions(
        (actions: Actions<ApplicationStore>) => actions.flashes,
    );
    const { secondary } = useStoreState(state => state.theme.data!.colors);
    const settings = useStoreState(state => state.everest.data!.billing);

    // Get multiplier steps from settings
    const getMultiplierSteps = () => {
        const stepsString = settings.renewal?.multiplier_steps;
        if (!stepsString) return [];
        try {
            if (typeof stepsString === 'string') {
                return JSON.parse(stepsString);
            }
            return stepsString;
        } catch {
            return [];
        }
    };

    const multiplierSteps = getMultiplierSteps();
    const defaultBillingDays = settings.renewal?.default_billing_days || 30;

    useEffect(() => {
        getCategory(Number(params.id)).then(category => setUuid(category.uuid));

        if (product) {
            getBillingCycles(Number(params.id), product.id).then(cycles => {
                // Filter out synthetic default entries (no id) — they are fallbacks, not real DB rows.
                setBillingCycles(
                    cycles
                        .filter(c => c.id !== undefined)
                        .map(c => ({ id: c.id, days: c.days, isEnabled: c.isEnabled ?? true })),
                );
            });
        }
    }, [params.id, product?.id]);

    // Don't render form until we have the category UUID
    if (!uuid) {
        return (
            <div css={tw`w-full flex flex-row items-center m-8`}>
                <p>Loading...</p>
            </div>
        );
    }

    const submit = (values: ProductValues, { setSubmitting }: FormikHelpers<ProductValues>) => {
        clearFlashes('admin:billing:product:create');

        const submitData = {
            ...values,
            base_price: values.basePrice,
        };

        if (!product) {
            createProduct(Number(params.id), submitData)
                .then(data => {
                    setSubmitting(false);

                    if (billingCycles.length > 0) {
                        syncBillingCycles(
                            Number(params.id),
                            data.id,
                            billingCycles.map(c => ({ days: c.days, is_enabled: c.isEnabled })),
                        )
                            .then(() => {
                                navigate(`/admin/billing/categories/${params.id}/products/${data.id}`);
                            })
                            .catch(error => {
                                clearAndAddHttpError({ key: 'admin:billing:product:create', error });
                            });
                    } else {
                        navigate(`/admin/billing/categories/${params.id}/products/${data.id}`);
                    }
                })
                .catch(error => {
                    setSubmitting(false);
                    clearAndAddHttpError({ key: 'admin:billing:product:create', error });
                });
        } else {
            updateProduct(Number(params.id), product!.id, submitData)
                .then(() => {
                    return syncBillingCycles(
                        Number(params.id),
                        product.id,
                        billingCycles.map(c => ({ days: c.days, is_enabled: c.isEnabled })),
                    );
                })
                .then(() => {
                    setSubmitting(false);
                    navigate(`/admin/billing/categories/${params.id}`);
                })
                .catch(error => {
                    setSubmitting(false);
                    clearAndAddHttpError({ key: 'admin:billing:product:create', error });
                });
        }
    };

    return (
        <>
            <div css={tw`w-full flex flex-row items-center m-8`}>
                {product?.icon ? (
                    <img src={product.icon} className={'ww-8 mr-4 h-8'} />
                ) : (
                    <CubeIcon className={'mr-4 h-8 w-8'} />
                )}
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>{product?.name ?? 'New Product'}</h2>
                    <p
                        css={tw`hidden lg:block text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}
                    >
                        {product?.uuid ?? 'Add a new product to the billing interface.'}
                    </p>
                </div>
                {product && (
                    <div className={'ml-auto mr-12 hidden md:flex'}>
                        <Link to={`/admin/billing/categories/${Number(params.id)}`}>
                            <Button>
                                <FontAwesomeIcon icon={faArrowLeft} className={'mr-2'} />
                                Return to Category
                            </Button>
                        </Link>
                    </div>
                )}
            </div>
            <Formik
                key={uuid} // Force re-render when uuid changes
                enableReinitialize
                onSubmit={submit}
                initialValues={{
                    categoryUuid: uuid,
                    name: product?.name ?? 'Plan Name',
                    icon: product?.icon ?? undefined,
                    // @ts-expect-error this is fine
                    price: product?.price?.toString() ?? '9.99',
                    // @ts-expect-error this is fine
                    basePrice: product?.basePrice?.toString() ?? null,
                    description: product?.description ?? 'This is a server plan.',
                    limits: {
                        cpu: product?.limits.cpu ?? 100,
                        memory: product?.limits.memory ?? 1024,
                        disk: product?.limits.disk ?? 4096,
                        backup: product?.limits.backup ?? 0,
                        database: product?.limits.database ?? 0,
                        allocation: product?.limits.allocation ?? 1,
                        subdomain: product?.limits.subdomain ?? 1,
                    },
                }}
                validationSchema={object().shape({
                    categoryUuid: string().required('Category UUID is required'),
                    name: string().required().max(191).min(3),
                    icon: string().nullable().notRequired().max(191).min(3),
                    price: number().typeError('Price must be a number').required().min(0, 'Price cannot be negative'),
                    basePrice: number()
                        .nullable()
                        .typeError('Base price must be a number')
                        .min(0, 'Base price cannot be negative'),
                    description: string().nullable().max(191).min(3),
                    limits: object().shape({
                        cpu: number().required().min(0),
                        memory: number().required().min(128),
                        disk: number().required().min(128),
                        backup: number().required().min(0),
                        database: number().required().min(0),
                        allocation: number().required().min(1),
                        subdomain: number().nullable().min(0),
                    }),
                })}
            >
                {({ values, isSubmitting, isValid, handleChange }) => (
                    <Form>
                        <div css={tw`grid grid-cols-1 lg:grid-cols-2 gap-4`}>
                            <div css={tw`w-full flex flex-col mr-0 lg:mr-2`}>
                                <AdminBox title={'General Details'} icon={faPuzzlePiece}>
                                    <FieldRow>
                                        <Field
                                            id={'name'}
                                            name={'name'}
                                            type={'text'}
                                            label={'Name'}
                                            description={'A simple name to identify this product.'}
                                        />
                                        <Field
                                            id={'description'}
                                            name={'description'}
                                            type={'text'}
                                            label={'Description'}
                                            description={'A tagline or description for this product.'}
                                        />
                                        <Field
                                            id={'icon'}
                                            name={'icon'}
                                            type={'text'}
                                            label={'Icon'}
                                            description={'An icon to be displayed with this product.'}
                                        />
                                    </FieldRow>
                                </AdminBox>

                                <AdminBox title={'Pricing Configuration'} className={'lg:mt-4'} icon={faDollarSign}>
                                    <FieldRow>
                                        <Field
                                            id={'price'}
                                            name={'price'}
                                            type={'text'}
                                            onChange={handleChange}
                                            label={'Legacy Monthly Cost'}
                                            description={
                                                'The legacy monthly price (kept for backward compatibility). Use Base Price for new pricing.'
                                            }
                                        />
                                        <Field
                                            id={'basePrice'}
                                            name={'basePrice'}
                                            type={'text'}
                                            onChange={handleChange}
                                            label={'Base Price (30 days)'}
                                            description={'The base price for 30 days. Leave empty to use legacy price.'}
                                        />
                                    </FieldRow>
                                    <Alert type={'info'} className={'mt-3'}>
                                        <div className="text-xs">
                                            <strong>Global Multiplier Steps (Read-Only):</strong>
                                            <div className="mt-2 space-y-1">
                                                <div>Default Billing Length: {defaultBillingDays} days</div>
                                                {multiplierSteps.length > 0 ? (
                                                    <>
                                                        <div className="mt-2">Multiplier Tiers:</div>
                                                        <ul className="list-disc list-inside ml-2">
                                                            {multiplierSteps.map((step: any, idx: number) => {
                                                                const discount = (1 - step.multiplier) * 100;
                                                                const label =
                                                                    discount > 0
                                                                        ? `${Math.abs(discount).toFixed(0)}% discount`
                                                                        : discount < 0
                                                                          ? `${Math.abs(discount).toFixed(0)}% premium`
                                                                          : 'base price';
                                                                return (
                                                                    <li key={idx}>
                                                                        Days ≤ {step.maxDays}:{' '}
                                                                        {step.multiplier.toFixed(2)}x ({label})
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    </>
                                                ) : (
                                                    <div className="text-gray-400">No multiplier steps configured</div>
                                                )}
                                            </div>
                                            <div className="mt-2 text-gray-400">
                                                To change these settings, go to <strong>Billing → Renewal Dates</strong>{' '}
                                                in the admin panel.
                                            </div>
                                        </div>
                                    </Alert>
                                </AdminBox>

                                <AdminBox title={'Resource Limits'} className={'lg:mt-4'} icon={faMicrochip}>
                                    <FieldRow>
                                        <Field
                                            id={'limits.cpu'}
                                            name={'limits.cpu'}
                                            type={'text'}
                                            label={'CPU Limit (%)'}
                                            description={'The amount of a CPU thread a server can use.'}
                                        />
                                        <Field
                                            id={'limits.memory'}
                                            name={'limits.memory'}
                                            type={'text'}
                                            label={'Memory Limit (MB)'}
                                            description={'The amount of memory a server is allowed to use.'}
                                        />
                                        <Field
                                            id={'limits.disk'}
                                            name={'limits.disk'}
                                            type={'text'}
                                            label={'Disk Limit (MB)'}
                                            description={'The amount of disk a server is allowed to use.'}
                                        />
                                    </FieldRow>
                                </AdminBox>
                            </div>
                            <div css={tw`w-full flex flex-col mr-0 lg:mr-2`}>
                                <AdminBox title={'Feature Limits'} icon={faBell}>
                                    <FieldRow>
                                        <Field
                                            id={'limits.backup'}
                                            name={'limits.backup'}
                                            type={'text'}
                                            label={'Backup Limit'}
                                            description={'The amount of backups this product can have.'}
                                        />
                                        <Field
                                            id={'limits.database'}
                                            name={'limits.database'}
                                            type={'text'}
                                            label={'Database Limit'}
                                            description={'The amount of databases this product can have.'}
                                        />
                                        <Field
                                            id={'limits.allocation'}
                                            name={'limits.allocation'}
                                            type={'text'}
                                            label={'Allocation (Port) Limit'}
                                            description={'The amount of ports this product can have.'}
                                        />
                                        <Field
                                            id={'limits.subdomain'}
                                            name={'limits.subdomain'}
                                            type={'text'}
                                            label={'Subdomain Limit'}
                                            description={'The amount of custom subdomains this product can have.'}
                                        />
                                    </FieldRow>
                                </AdminBox>

                                <AdminBox title={'Billing Cycles'} className={'lg:mt-4'} icon={faCalendarAlt}>
                                    <BillingCyclesManager
                                        cycles={billingCycles}
                                        basePrice={Number(values.basePrice || values.price)}
                                        onChange={setBillingCycles}
                                    />
                                </AdminBox>

                                {/* Dynamic alerts based on price */}
                                {Number(values.price) === 0 && (
                                    <Alert type={'warning'} className={'mt-4'}>
                                        You have set this product to be free. Please confirm this choice before
                                        proceeding, otherwise users will be able to use this plan without payment.
                                    </Alert>
                                )}
                                {Number(values.price) === 0 && (
                                    <Alert type={'info'} className={'mt-4'}>
                                        As this product is free, users will only be able to use it once to prevent
                                        abuse.
                                    </Alert>
                                )}
                                <div css={tw`rounded shadow-md mt-4 py-2 pr-6`} style={{ backgroundColor: secondary }}>
                                    <div css={tw`text-right`}>
                                        {product && <ProductDeleteButton product={product} />}
                                        <Button type={'submit'} disabled={isSubmitting || !isValid}>
                                            {product ? 'Update Product' : 'Create Product'}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Form>
                )}
            </Formik>
        </>
    );
};
