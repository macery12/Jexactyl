import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';

interface PriceBreakdownProps {
    basePrice: number;
    billingDays: number;
    billingMultiplier: number;
    billingDiscountPercent: number;
    nodeMultiplier?: number;
    nodeName?: string;
    couponDiscount?: number;
    couponCode?: string;
}

const formatPrice = (price: number) => `$${price.toFixed(2)}`;
const formatPercent = (percent: number) => {
    if (percent === 0) return 'Standard';
    if (percent > 0) return `${percent.toFixed(0)}% discount`;
    return `${Math.abs(percent).toFixed(0)}% premium`;
};

export default ({
    basePrice,
    billingDays,
    billingMultiplier,
    billingDiscountPercent,
    nodeMultiplier = 1.0,
    nodeName,
    couponDiscount = 0,
    couponCode,
}: PriceBreakdownProps) => {
    const { colors } = useStoreState(state => state.theme.data!);

    // Calculate intermediate values
    const afterBillingCycle = basePrice * billingMultiplier;
    const afterNodeMultiplier = afterBillingCycle * nodeMultiplier;
    const finalTotal = Math.max(0, afterNodeMultiplier - couponDiscount);

    const nodeDiscountPercent = (nodeMultiplier - 1) * 100;

    return (
        <div
            className={'rounded-lg border p-6 space-y-3'}
            style={{ backgroundColor: colors.secondary, borderColor: '#374151' }}
        >
            <h3 className={'mb-4 text-lg font-bold text-gray-200'}>Price Breakdown</h3>

            {/* Plan Price (includes base price + billing cycle) */}
            <div className={'flex items-center justify-between text-sm'}>
                <div className={'flex flex-col'}>
                    <span className={'text-gray-400'}>Plan Price ({billingDays}-day cycle)</span>
                    {billingMultiplier !== 1.0 && (
                        <span
                            className={'text-xs'}
                            css={[
                                billingDiscountPercent === 0 && tw`text-blue-400`,
                                billingDiscountPercent > 0 && tw`text-green-400`,
                                billingDiscountPercent < 0 && tw`text-red-400`,
                            ]}
                        >
                            {formatPercent(billingDiscountPercent)}
                        </span>
                    )}
                </div>
                <div className={'flex flex-col items-end'}>
                    <span className={'font-medium text-gray-200'}>{formatPrice(afterBillingCycle)}</span>
                    {billingMultiplier !== 1.0 && (
                        <span className={'text-xs text-gray-500'}>×{billingMultiplier.toFixed(2)}</span>
                    )}
                </div>
            </div>

            {/* Node Location Adjustment */}
            {nodeMultiplier !== 1.0 && nodeName && (
                <div className={'flex items-center justify-between text-sm'}>
                    <div className={'flex flex-col'}>
                        <span className={'text-gray-400'}>Location: {nodeName}</span>
                        <span
                            className={'text-xs'}
                            css={[
                                nodeDiscountPercent === 0 && tw`text-blue-400`,
                                nodeDiscountPercent > 0 && tw`text-red-400`,
                                nodeDiscountPercent < 0 && tw`text-green-400`,
                            ]}
                        >
                            {nodeDiscountPercent > 0
                                ? `+${nodeDiscountPercent.toFixed(0)}% premium`
                                : `${Math.abs(nodeDiscountPercent).toFixed(0)}% discount`}
                        </span>
                    </div>
                    <div className={'flex flex-col items-end'}>
                        <span className={'font-medium text-gray-200'}>{formatPrice(afterNodeMultiplier)}</span>
                        <span className={'text-xs text-gray-500'}>×{nodeMultiplier.toFixed(2)}</span>
                    </div>
                </div>
            )}

            {/* Coupon Discount */}
            {couponDiscount > 0 && couponCode && (
                <>
                    <div className={'border-t border-gray-700 pt-3'} />
                    <div className={'flex items-center justify-between text-sm'}>
                        <div className={'flex flex-col'}>
                            <span className={'text-gray-400'}>Coupon: {couponCode}</span>
                            <span className={'text-xs text-green-400'}>Discount applied</span>
                        </div>
                        <span className={'font-medium text-green-400'}>-{formatPrice(couponDiscount)}</span>
                    </div>
                </>
            )}

            {/* Final Total */}
            <div className={'border-t border-gray-700 pt-3'} />
            <div className={'flex items-center justify-between'}>
                <span className={'text-lg font-bold text-gray-200'}>Total Due</span>
                <span className={'text-2xl font-bold'} style={{ color: colors.primary }}>
                    {formatPrice(finalTotal)}
                </span>
            </div>

            {/* Savings Indicator */}
            {(billingDiscountPercent > 0 || nodeDiscountPercent < 0 || couponDiscount > 0) && (
                <div className={'text-center text-xs text-green-400 pt-2'}>
                    You're saving {formatPrice(basePrice - finalTotal)} from the base price!
                </div>
            )}
        </div>
    );
};
