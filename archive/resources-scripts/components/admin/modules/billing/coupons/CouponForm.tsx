import type { FormikHelpers } from 'formik';
import { Form, Formik, useFormikContext } from 'formik';
import { useNavigate, useParams } from 'react-router-dom';
import Field, { FieldRow } from '@/elements/Field';
import tw from 'twin.macro';
import AdminContentBlock from '@/elements/AdminContentBlock';
import { Button } from '@/elements/button';
import AdminBox from '@/elements/AdminBox';
import { createCoupon, getCoupon, updateCoupon } from '@/api/routes/admin/billing/coupons';
import { object, string, boolean, number } from 'yup';
import { faTicketAlt } from '@fortawesome/free-solid-svg-icons';
import Label from '@/elements/Label';
import { useEffect, useState } from 'react';
import { CouponValues } from '@/api/routes/admin/billing/types';
import useFlash from '@/plugins/useFlash';
import { Coupon } from '@definitions/admin';
import Select from '@/elements/Select';
import CouponDeleteButton from './CouponDeleteButton';

function InternalForm({ coupon }: { coupon?: Coupon }) {
    const { values, isSubmitting, setFieldValue } = useFormikContext<CouponValues>();

    return (
        <Form>
            <div css={tw`grid grid-cols-1 lg:grid-cols-2 gap-4`}>
                <div css={tw`w-full flex flex-col mr-0 lg:mr-2`}>
                    <AdminBox title={'Coupon Details'} icon={faTicketAlt} isLoading={isSubmitting}>
                        <FieldRow>
                            <Field
                                id={'code'}
                                name={'code'}
                                type={'text'}
                                placeholder={'SAVE20'}
                                label={'Coupon Code'}
                                description={'Unique code for this coupon (will be uppercase).'}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    setFieldValue('code', e.target.value.toUpperCase());
                                }}
                            />
                            <div className={'mb-6'}>
                                <Label htmlFor={'type'}>Discount Type</Label>
                                <Select
                                    id={'type'}
                                    name={'type'}
                                    value={values.type}
                                    onChange={e => setFieldValue('type', e.target.value)}
                                >
                                    <option value={'percentage'}>Percentage</option>
                                    <option value={'fixed'}>Fixed Amount</option>
                                </Select>
                                <p className={'mt-2 text-xs text-neutral-400'}>
                                    Whether to discount by percentage or fixed amount.
                                </p>
                            </div>
                            <Field
                                id={'value'}
                                name={'value'}
                                type={'number'}
                                placeholder={'20'}
                                label={'Discount Value'}
                                description={
                                    values.type === 'percentage'
                                        ? 'Percentage to discount (e.g., 20 for 20% off).'
                                        : 'Fixed amount to discount (e.g., 10 for $10 off).'
                                }
                            />
                        </FieldRow>
                    </AdminBox>
                </div>

                <div css={tw`w-full flex flex-col ml-0 lg:ml-2`}>
                    <AdminBox title={'Usage Limits'} icon={faTicketAlt} isLoading={isSubmitting}>
                        <FieldRow>
                            <Field
                                id={'maxUses'}
                                name={'maxUses'}
                                type={'number'}
                                placeholder={'Leave empty for unlimited'}
                                label={'Max Uses'}
                                description={'Total number of times this coupon can be used (null for unlimited).'}
                            />
                            <Field
                                id={'maxUsesPerUser'}
                                name={'maxUsesPerUser'}
                                type={'number'}
                                placeholder={'Leave empty for unlimited'}
                                label={'Max Uses Per User'}
                                description={'Number of times each user can use this coupon (null for unlimited).'}
                            />
                            <Field
                                id={'minOrderTotal'}
                                name={'minOrderTotal'}
                                type={'number'}
                                placeholder={'Leave empty for no minimum'}
                                label={'Minimum Order Total'}
                                description={'Minimum order amount required to use this coupon (null for no minimum).'}
                            />
                            <Field
                                id={'expiresAt'}
                                name={'expiresAt'}
                                type={'datetime-local'}
                                label={'Expires At'}
                                description={'When this coupon expires (leave empty to never expire).'}
                            />
                            <div className={'mb-6'}>
                                <Label htmlFor={'allowedFor'}>Allowed For</Label>
                                <Select
                                    id={'allowedFor'}
                                    name={'allowedFor'}
                                    value={values.allowedFor}
                                    onChange={e => setFieldValue('allowedFor', e.target.value)}
                                >
                                    <option value={'both'}>Both Purchases and Renewals</option>
                                    <option value={'purchases'}>Purchases Only</option>
                                    <option value={'renewals'}>Renewals Only</option>
                                </Select>
                                <p className={'mt-2 text-xs text-neutral-400'}>
                                    Whether this coupon can be used for new purchases, renewals, or both.
                                </p>
                            </div>
                            <div className={'mt-1'}>
                                <Label htmlFor={'isActive'}>Status</Label>
                                <div className={'mt-1'}>
                                    <label css={tw`inline-flex items-center mr-2`}>
                                        <input
                                            name={'isActive'}
                                            type={'radio'}
                                            checked={values.isActive === true}
                                            onChange={() => setFieldValue('isActive', true)}
                                        />
                                        <span css={tw`text-neutral-300 ml-2`}>Active</span>
                                    </label>

                                    <label css={tw`inline-flex items-center ml-2`}>
                                        <input
                                            name={'isActive'}
                                            type={'radio'}
                                            checked={values.isActive === false}
                                            onChange={() => setFieldValue('isActive', false)}
                                        />
                                        <span css={tw`text-neutral-300 ml-2`}>Inactive</span>
                                    </label>
                                </div>
                                <p className={'mt-2 text-xs text-neutral-400'}>
                                    Whether this coupon is currently active and can be used.
                                </p>
                            </div>
                        </FieldRow>
                    </AdminBox>
                </div>
            </div>
            <div css={tw`mt-4 flex justify-between`}>
                {coupon && <CouponDeleteButton coupon={coupon} />}
                <Button type={'submit'} disabled={isSubmitting}>
                    {coupon ? 'Update Coupon' : 'Create Coupon'}
                </Button>
            </div>
        </Form>
    );
}

export default function CouponForm() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const [coupon, setCoupon] = useState<Coupon | undefined>();

    useEffect(() => {
        clearFlashes('admin:billing:coupons');

        if (id) {
            getCoupon(Number(id))
                .then(setCoupon)
                .catch(error => {
                    console.error(error);
                    clearAndAddHttpError({ key: 'admin:billing:coupons', error });
                });
        }
    }, [id]);

    const submit = (values: CouponValues, { setSubmitting }: FormikHelpers<CouponValues>) => {
        clearFlashes('admin:billing:coupons');

        const promise = coupon ? updateCoupon(coupon.id, values) : createCoupon(values);

        promise
            .then(() => navigate('/admin/billing/coupons'))
            .catch(error => {
                console.error(error);
                clearAndAddHttpError({ key: 'admin:billing:coupons', error });
            })
            .finally(() => setSubmitting(false));
    };

    const initialValues: CouponValues = coupon
        ? {
              code: coupon.code,
              type: coupon.type,
              value: coupon.value,
              maxUses: coupon.maxUses,
              maxUsesPerUser: coupon.maxUsesPerUser,
              minOrderTotal: coupon.minOrderTotal,
              expiresAt: coupon.expiresAt ? coupon.expiresAt.toISOString().slice(0, 16) : null,
              isActive: coupon.isActive,
              allowedFor: coupon.allowedFor || 'both',
          }
        : {
              code: '',
              type: 'percentage',
              value: 0,
              maxUses: null,
              maxUsesPerUser: null,
              minOrderTotal: null,
              expiresAt: null,
              isActive: true,
              allowedFor: 'both',
          };

    return (
        <AdminContentBlock title={coupon ? 'Edit Coupon' : 'Create Coupon'}>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>
                        {coupon ? `Edit ${coupon.code}` : 'Create Coupon'}
                    </h2>
                    <p className={'overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400'}>
                        {coupon ? 'Edit an existing coupon' : 'Create a new discount coupon'}
                    </p>
                </div>
            </div>

            <Formik
                onSubmit={submit}
                initialValues={initialValues}
                enableReinitialize={true}
                validationSchema={object().shape({
                    code: string().required().min(2).max(50),
                    type: string().required().oneOf(['percentage', 'fixed']),
                    value: number().required().min(0),
                    maxUses: number().nullable().min(1),
                    maxUsesPerUser: number().nullable().min(1),
                    minOrderTotal: number().nullable().min(0),
                    expiresAt: string().nullable(),
                    isActive: boolean().required(),
                    allowedFor: string().required().oneOf(['both', 'purchases', 'renewals']),
                })}
            >
                <InternalForm coupon={coupon} />
            </Formik>
        </AdminContentBlock>
    );
}
