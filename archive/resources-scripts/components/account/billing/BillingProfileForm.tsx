import { useState } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import {
    type BillingProfile,
    type BillingProfileInput,
    saveBillingProfile,
} from '@/api/routes/account/billing/billingProfile';
import AddressAutocompleteInput from '@account/billing/AddressAutocompleteInput';
import { type AddressSuggestion } from '@/api/routes/account/billing/addressAutocomplete';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';

const FLASH_KEY = 'account:billing-profile';

const schema = Yup.object({
    first_name: Yup.string().required('First name is required').max(100),
    last_name: Yup.string().required('Last name is required').max(100),
    address_line1: Yup.string().required('Address is required').max(255),
    address_line2: Yup.string().nullable().max(255),
    city: Yup.string().required('City is required').max(100),
    state: Yup.string().required('State / region is required').max(100),
    postal_code: Yup.string().required('Postal code is required').max(20),
    country: Yup.string().required('Country is required').length(2, 'Use a 2-letter ISO country code (e.g. US)'),
    phone: Yup.string().nullable().max(30),
});

interface Props {
    existing: BillingProfile | null;
    onSaved: (profile: BillingProfile) => void;
}

export default function BillingProfileForm({ existing, onSaved }: Props) {
    const { clearAndAddHttpError, clearFlashes } = useFlash();
    const [autocompleteQuery, setAutocompleteQuery] = useState(existing?.address_line1 ?? '');

    const formik = useFormik<BillingProfileInput>({
        initialValues: {
            first_name: existing?.first_name ?? '',
            last_name: existing?.last_name ?? '',
            address_line1: existing?.address_line1 ?? '',
            address_line2: existing?.address_line2 ?? '',
            city: existing?.city ?? '',
            state: existing?.state ?? '',
            postal_code: existing?.postal_code ?? '',
            country: existing?.country ?? '',
            phone: existing?.phone ?? '',
        },
        validationSchema: schema,
        onSubmit: async (values, { setSubmitting }) => {
            clearFlashes(FLASH_KEY);
            try {
                const saved = await saveBillingProfile(
                    {
                        ...values,
                        address_line2: values.address_line2 || null,
                        phone: values.phone || null,
                    },
                    existing !== null,
                );
                onSaved(saved);
            } catch (err) {
                clearAndAddHttpError({ key: FLASH_KEY, error: err });
            } finally {
                setSubmitting(false);
            }
        },
    });

    const handleAutocompleteSelect = (suggestion: AddressSuggestion) => {
        formik.setValues({
            ...formik.values,
            address_line1: suggestion.line1 || formik.values.address_line1,
            city: suggestion.city || formik.values.city,
            state: suggestion.state || formik.values.state,
            postal_code: suggestion.postal_code || formik.values.postal_code,
            country: suggestion.country_code || formik.values.country,
        });
        setAutocompleteQuery(suggestion.line1 || formik.values.address_line1);
    };

    const field = (
        name: keyof BillingProfileInput,
        label: string,
        opts?: { type?: string; placeholder?: string; required?: boolean },
    ) => {
        const required = opts?.required !== false;
        const touched = formik.touched[name];
        const error = formik.errors[name];
        return (
            <div className={'flex flex-col gap-1'}>
                <label htmlFor={name} className={'text-sm font-medium text-neutral-300'}>
                    {label}
                    {required && <span className={'ml-1 text-red-400'}>*</span>}
                </label>
                <input
                    id={name}
                    name={name}
                    type={opts?.type ?? 'text'}
                    placeholder={opts?.placeholder}
                    value={(formik.values[name] as string) ?? ''}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    autoComplete={'off'}
                    className={
                        'rounded border bg-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-1 ' +
                        (touched && error
                            ? 'border-red-500 focus:ring-red-500'
                            : 'border-neutral-600 focus:border-blue-500 focus:ring-blue-500')
                    }
                />
                {touched && error && <p className={'text-xs text-red-400'}>{error}</p>}
            </div>
        );
    };

    return (
        <form onSubmit={formik.handleSubmit} className={'space-y-4'}>
            <FlashMessageRender byKey={FLASH_KEY} />

            {/* Address search */}
            <div className={'flex flex-col gap-1'}>
                <label className={'text-sm font-medium text-neutral-300'}>Search address</label>
                <AddressAutocompleteInput
                    value={autocompleteQuery}
                    onChange={setAutocompleteQuery}
                    onSelect={handleAutocompleteSelect}
                    disabled={formik.isSubmitting}
                    placeholder={'Start typing to search and auto-fill fields below…'}
                />
                <p className={'text-xs text-neutral-500'}>Powered by OpenStreetMap / Nominatim</p>
            </div>

            <div className={'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
                {field('first_name', 'First Name')}
                {field('last_name', 'Last Name')}
            </div>

            {field('address_line1', 'Address Line 1')}
            {field('address_line2', 'Address Line 2', {
                required: false,
                placeholder: 'Apartment, suite, etc. (optional)',
            })}

            <div className={'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
                {field('city', 'City')}
                {field('state', 'State / Region')}
            </div>

            <div className={'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
                {field('postal_code', 'Postal Code')}
                {field('country', 'Country Code', { placeholder: 'US' })}
            </div>

            {field('phone', 'Phone Number', {
                required: false,
                placeholder: '+1 555 000 0000 (optional)',
                type: 'tel',
            })}

            <div className={'flex justify-end pt-2'}>
                <Button type={'submit'} disabled={formik.isSubmitting || !formik.dirty}>
                    {formik.isSubmitting ? 'Saving…' : existing ? 'Update Billing Info' : 'Save Billing Info'}
                </Button>
            </div>
        </form>
    );
}
