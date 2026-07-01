import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveBillingProfile, type BillingProfile } from '@/api/accountBilling';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

interface FormState {
    first_name: string;
    last_name: string;
    address_line1: string;
    address_line2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    phone: string;
}

function seed(profile: BillingProfile | null): FormState {
    return {
        first_name: profile?.first_name ?? '',
        last_name: profile?.last_name ?? '',
        address_line1: profile?.address_line1 ?? '',
        address_line2: profile?.address_line2 ?? '',
        city: profile?.city ?? '',
        state: profile?.state ?? '',
        postal_code: profile?.postal_code ?? '',
        country: profile?.country ?? '',
        phone: profile?.phone ?? '',
    };
}

export function BillingAddressModal({
    open,
    onClose,
    profile,
    exists,
}: {
    open: boolean;
    onClose: () => void;
    profile: BillingProfile | null;
    exists: boolean;
}) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [form, setForm] = useState<FormState>(() => seed(profile));

    const set = (key: keyof FormState, value: string) => setForm(f => ({ ...f, [key]: value }));

    const mutation = useMutation({
        mutationFn: () =>
            saveBillingProfile(
                {
                    first_name: form.first_name.trim(),
                    last_name: form.last_name.trim(),
                    address_line1: form.address_line1.trim(),
                    address_line2: form.address_line2.trim() || null,
                    city: form.city.trim(),
                    state: form.state.trim(),
                    postal_code: form.postal_code.trim(),
                    country: form.country.trim().toUpperCase(),
                    phone: form.phone.trim() || null,
                },
                exists,
            ),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['account', 'billing-profile'] });
            push({ type: 'success', message: m['account.billing.success']() });
            onClose();
        },
        onError: (err: unknown) => push({ type: 'error', message: firstError(err) ?? m['account.billing.error']() }),
    });

    const valid =
        form.first_name.trim() &&
        form.last_name.trim() &&
        form.address_line1.trim() &&
        form.city.trim() &&
        form.state.trim() &&
        form.postal_code.trim() &&
        form.country.trim().length === 2;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={exists ? m['account.billing.modalTitleEdit']() : m['account.billing.modalTitleAdd']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['account.billing.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => valid && mutation.mutate()} disabled={!valid || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.billing.save']()}
                    </Button>
                </>
            }
        >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={m['account.billing.firstName']()} htmlFor="ba-first">
                    <Input id="ba-first" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
                </Field>
                <Field label={m['account.billing.lastName']()} htmlFor="ba-last">
                    <Input id="ba-last" value={form.last_name} onChange={e => set('last_name', e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                    <Field label={m['account.billing.addressLine1']()} htmlFor="ba-l1">
                        <Input id="ba-l1" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} />
                    </Field>
                </div>
                <div className="sm:col-span-2">
                    <Field label={m['account.billing.addressLine2']()} hint={m['account.billing.optional']()} htmlFor="ba-l2">
                        <Input id="ba-l2" value={form.address_line2} onChange={e => set('address_line2', e.target.value)} />
                    </Field>
                </div>
                <Field label={m['account.billing.city']()} htmlFor="ba-city">
                    <Input id="ba-city" value={form.city} onChange={e => set('city', e.target.value)} />
                </Field>
                <Field label={m['account.billing.state']()} htmlFor="ba-state">
                    <Input id="ba-state" value={form.state} onChange={e => set('state', e.target.value)} />
                </Field>
                <Field label={m['account.billing.postalCode']()} htmlFor="ba-zip">
                    <Input id="ba-zip" value={form.postal_code} onChange={e => set('postal_code', e.target.value)} />
                </Field>
                <Field label={m['account.billing.country']()} hint={m['account.billing.countryLen']()} htmlFor="ba-country">
                    <Input
                        id="ba-country"
                        maxLength={2}
                        value={form.country}
                        onChange={e => set('country', e.target.value.toUpperCase())}
                    />
                </Field>
                <div className="sm:col-span-2">
                    <Field label={m['account.billing.phone']()} hint={m['account.billing.optional']()} htmlFor="ba-phone">
                        <Input id="ba-phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
                    </Field>
                </div>
            </div>
        </Modal>
    );
}
