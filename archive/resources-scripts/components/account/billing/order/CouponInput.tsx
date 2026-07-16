import { useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import Input from '@/elements/Input';
import { validateCoupon, ValidateCouponResponse } from '@/api/routes/account/billing/coupons';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Alert } from '@/elements/alert';

type CouponApplyStatus = 'applied' | 'removed' | 'invalid';

interface Props {
    subtotal: number;
    onCouponApplied: (couponData: ValidateCouponResponse | null, status: CouponApplyStatus) => void;
    orderType?: 'new' | 'ren' | 'upg';
}

export default ({ subtotal, onCouponApplied, orderType = 'new' }: Props) => {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [applied, setApplied] = useState<ValidateCouponResponse | null>(null);
    const { clearFlashes, clearAndAddHttpError, addFlash } = useFlash();

    const handleApply = () => {
        if (!code.trim()) return;

        setLoading(true);
        clearFlashes('coupon');

        validateCoupon(code.trim(), subtotal, orderType)
            .then(data => {
                setApplied(data);
                onCouponApplied(data, 'applied');
                addFlash({
                    key: 'coupon',
                    type: 'success',
                    message: `Coupon ${data.coupon.code} applied successfully!`,
                });
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'coupon', error });
                setApplied(null);
                onCouponApplied(null, 'invalid');
            })
            .finally(() => setLoading(false));
    };

    const handleRemove = () => {
        setCode('');
        setApplied(null);
        onCouponApplied(null, 'removed');
        clearFlashes('coupon');
    };

    return (
        <div className={'mt-4'}>
            <div className={'flex items-end gap-2'}>
                <div className={'flex-1'}>
                    <label htmlFor={'coupon'} className={'mb-1 block text-sm text-gray-400'}>
                        Coupon Code
                    </label>
                    <Input
                        id={'coupon'}
                        type={'text'}
                        value={code}
                        onChange={e => setCode(e.target.value.toUpperCase())}
                        placeholder={'Enter coupon code'}
                        disabled={applied !== null}
                    />
                </div>
                {applied ? (
                    <Button.Text onClick={handleRemove} variant={Button.Variants.Secondary}>
                        Remove
                    </Button.Text>
                ) : (
                    <Button.Text onClick={handleApply} disabled={!code.trim() || loading}>
                        Apply
                    </Button.Text>
                )}
            </div>
            <SpinnerOverlay visible={loading} />
            {applied && (
                <Alert type={'success'} className={'mt-2'}>
                    Coupon {applied.coupon.code} applied:{' '}
                    {applied.coupon.type === 'percentage'
                        ? `${applied.coupon.value}% off`
                        : `$${applied.coupon.value} off`}
                </Alert>
            )}
        </div>
    );
};
