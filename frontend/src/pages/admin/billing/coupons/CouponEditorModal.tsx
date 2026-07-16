import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
    createCoupon,
    updateCoupon,
    type Coupon,
    type CouponAllowedFor,
    type CouponType,
    type CouponValues,
} from '@/api/adminBillingCoupons';

function toForm(c: Coupon | null): CouponValues {
    if (!c) {
        return {
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
    }
    return {
        code: c.code,
        type: c.type,
        value: c.value,
        maxUses: c.maxUses,
        maxUsesPerUser: c.maxUsesPerUser,
        minOrderTotal: c.minOrderTotal,
        expiresAt: c.expiresAt ? c.expiresAt.slice(0, 16) : null,
        isActive: c.isActive,
        allowedFor: c.allowedFor,
    };
}

function numOrNull(v: string): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
}

export default function CouponEditorModal({
    open,
    coupon,
    onClose,
}: {
    open: boolean;
    coupon: Coupon | null;
    onClose: () => void;
}) {
    const qc = useQueryClient();
    const { push } = useFlashes();
    const [form, setForm] = useState<CouponValues>(toForm(coupon));

    useEffect(() => {
        if (open) setForm(toForm(coupon));
    }, [open, coupon]);

    const set = <K extends keyof CouponValues>(key: K, value: CouponValues[K]) => setForm(f => ({ ...f, [key]: value }));

    const save = useMutation({
        mutationFn: async () => {
            const payload: CouponValues = { ...form, expiresAt: form.expiresAt || null };
            if (coupon) await updateCoupon(coupon.id, payload);
            else await createCoupon(payload);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'coupons'] });
            push({ type: 'success', message: coupon ? m['admin.billing.coupons.updated']() : m['admin.billing.coupons.created']() });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const typeOptions = [
        { value: 'percentage', label: m['admin.billing.coupons.type.percentage']() },
        { value: 'fixed', label: m['admin.billing.coupons.type.fixed']() },
    ];
    const allowedForOptions = [
        { value: 'both', label: m['admin.billing.coupons.allowedFor.both']() },
        { value: 'purchases', label: m['admin.billing.coupons.allowedFor.purchases']() },
        { value: 'renewals', label: m['admin.billing.coupons.allowedFor.renewals']() },
    ];
    const statusOptions = [
        { value: 'true', label: m['admin.billing.coupons.active']() },
        { value: 'false', label: m['admin.billing.coupons.inactive']() },
    ];

    const canSave = form.code.trim().length >= 2 && form.value >= 0;

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={coupon ? m['admin.billing.coupons.editTitle']({ code: coupon.code }) : m['admin.billing.coupons.newTitle']()}
            description={m['admin.billing.coupons.modalDesc']()}
        >
            <form
                onSubmit={e => {
                    e.preventDefault();
                    if (canSave) save.mutate();
                }}
                className="flex flex-col gap-5"
            >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label={m['admin.billing.coupons.code']()} hint={m['admin.billing.coupons.codeDesc']()}>
                        <Input
                            value={form.code}
                            onChange={e => set('code', e.target.value.toUpperCase())}
                            placeholder="SAVE20"
                        />
                    </Field>
                    <Field label={m['admin.billing.coupons.type']()}>
                        <Select value={form.type} onChange={v => set('type', v as CouponType)} options={typeOptions} />
                    </Field>
                    <Field
                        label={m['admin.billing.coupons.value']()}
                        hint={form.type === 'percentage' ? m['admin.billing.coupons.valuePercentDesc']() : m['admin.billing.coupons.valueFixedDesc']()}
                    >
                        <Input type="number" value={String(form.value)} onChange={e => set('value', Number(e.target.value) || 0)} />
                    </Field>
                    <Field label={m['admin.billing.coupons.status']()}>
                        <Select
                            value={String(form.isActive)}
                            onChange={v => set('isActive', v === 'true')}
                            options={statusOptions}
                        />
                    </Field>
                    <Field label={m['admin.billing.coupons.maxUses']()} hint={m['admin.billing.coupons.maxUsesDesc']()}>
                        <Input
                            type="number"
                            value={form.maxUses == null ? '' : String(form.maxUses)}
                            onChange={e => set('maxUses', numOrNull(e.target.value))}
                            placeholder={m['admin.billing.coupons.unlimited']()}
                        />
                    </Field>
                    <Field label={m['admin.billing.coupons.maxUsesPerUser']()} hint={m['admin.billing.coupons.maxUsesPerUserDesc']()}>
                        <Input
                            type="number"
                            value={form.maxUsesPerUser == null ? '' : String(form.maxUsesPerUser)}
                            onChange={e => set('maxUsesPerUser', numOrNull(e.target.value))}
                            placeholder={m['admin.billing.coupons.unlimited']()}
                        />
                    </Field>
                    <Field label={m['admin.billing.coupons.minOrderTotal']()} hint={m['admin.billing.coupons.minOrderTotalDesc']()}>
                        <Input
                            type="number"
                            value={form.minOrderTotal == null ? '' : String(form.minOrderTotal)}
                            onChange={e => set('minOrderTotal', numOrNull(e.target.value))}
                            placeholder={m['admin.billing.coupons.noMinimum']()}
                        />
                    </Field>
                    <Field label={m['admin.billing.coupons.expiresAt']()} hint={m['admin.billing.coupons.expiresAtDesc']()}>
                        <Input
                            type="datetime-local"
                            value={form.expiresAt ?? ''}
                            onChange={e => set('expiresAt', e.target.value || null)}
                        />
                    </Field>
                    <Field label={m['admin.billing.coupons.allowedFor']()} hint={m['admin.billing.coupons.allowedForDesc']()}>
                        <Select value={form.allowedFor} onChange={v => set('allowedFor', v as CouponAllowedFor)} options={allowedForOptions} />
                    </Field>
                </div>

                <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button type="submit" disabled={!canSave || save.isPending}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {coupon ? m['common.actions.saveChanges']() : m['admin.billing.coupons.create']()}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
