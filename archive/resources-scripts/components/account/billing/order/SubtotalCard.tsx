import { useStoreState } from '@/state/hooks';
import { type Node } from '@definitions/account/billing';
import { type BillingCycle, type EggInfo } from '@/api/routes/account/billing/products';
import CouponInput from '@account/billing/order/CouponInput';
import { ValidateCouponResponse } from '@/api/routes/account/billing/coupons';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';

interface SubtotalCardProps {
    basePrice: number;
    selectedNode?: number;
    nodes?: Node[];
    selectedEggId?: number;
    availableEggs: EggInfo[];
    selectedBillingDays: number;
    billingCycles: BillingCycle[];
    couponDiscount?: number;
    couponCode?: string;
    productName?: string;
    showDetailedBreakdown?: boolean;
    showCouponInput?: boolean;
    onCouponApplied?: (data: ValidateCouponResponse | null, status: 'applied' | 'removed' | 'invalid') => void;
}

const formatPrice = (price: number) => `$${price.toFixed(2)}`;
const MINIMUM_DISCOUNT_DISPLAY = 0.01;

export default ({
    basePrice,
    selectedNode,
    nodes,
    selectedEggId,
    availableEggs,
    selectedBillingDays,
    billingCycles,
    couponDiscount = 0,
    couponCode,
    productName,
    showDetailedBreakdown = false,
    showCouponInput = false,
    onCouponApplied,
}: SubtotalCardProps) => {
    const { colors } = useStoreState(state => state.theme.data!);
    const [showCoupon, setShowCoupon] = useState<boolean>(false);

    // Get selected cycle data
    const selectedCycle = billingCycles.find(c => c.days === selectedBillingDays);
    const selectedNodeData = nodes?.find(n => Number(n.id) === selectedNode);
    const selectedEgg = availableEggs.find(e => e.id === selectedEggId);

    // Calculate pricing
    const afterBillingCycle = selectedCycle?.price ?? basePrice;
    const afterNodeMultiplier = afterBillingCycle * (selectedNodeData?.priceMultiplier || 1.0);
    const subtotal = afterNodeMultiplier;
    const total = Math.max(0, subtotal - couponDiscount);

    const hasDiscount = (selectedCycle?.discountPercent || 0) > 0;
    const hasPremium = (selectedCycle?.discountPercent || 0) < 0;
    const hasNodePremium = (selectedNodeData?.priceMultiplier || 1.0) > 1.0;
    const hasNodeDiscount = (selectedNodeData?.priceMultiplier || 1.0) < 1.0;

    const nodeMultiplier = selectedNodeData?.priceMultiplier || 1.0;

    // Calculate actual dollar difference for node location pricing
    const nodePriceDifference = afterNodeMultiplier - afterBillingCycle;

    return (
        <div
            className={'rounded-lg border p-5 shadow-lg'}
            style={{ backgroundColor: colors.secondary, borderColor: '#374151' }}
        >
            {/* Header */}
            <div className={'mb-4'}>
                <h3 className={'text-lg font-bold text-gray-200'}>Order Summary</h3>
                {productName && <p className={'text-sm text-gray-400 mt-1'}>{productName}</p>}
            </div>

            {/* Selected Options */}
            <div className={'space-y-3 mb-4 pb-4 border-b border-gray-700'}>
                {/* Node Location */}
                {selectedNodeData ? (
                    <div className={'flex items-start justify-between text-sm'}>
                        <span className={'text-gray-400'}>Location</span>
                        <div className={'flex flex-col items-end'}>
                            <span className={'text-gray-200 font-medium'}>{selectedNodeData.name}</span>
                            {selectedNodeData.priceMultiplierDescription && (
                                <span className={'text-xs text-gray-500 text-right'}>
                                    {selectedNodeData.priceMultiplierDescription}
                                </span>
                            )}
                            {hasNodePremium && (
                                <span className={'text-xs text-red-400'}>+{formatPrice(nodePriceDifference)}</span>
                            )}
                            {hasNodeDiscount && (
                                <span className={'text-xs text-green-400'}>{formatPrice(nodePriceDifference)}</span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className={'flex items-center justify-between text-sm'}>
                        <span className={'text-gray-500'}>Location</span>
                        <span className={'text-gray-600'}>Not selected</span>
                    </div>
                )}

                {/* Server Type (if multiple eggs available) */}
                {availableEggs.length > 1 &&
                    (selectedEgg ? (
                        <div className={'flex items-center justify-between text-sm'}>
                            <span className={'text-gray-400'}>Server Type</span>
                            <span className={'text-gray-200 font-medium'}>{selectedEgg.name}</span>
                        </div>
                    ) : (
                        <div className={'flex items-center justify-between text-sm'}>
                            <span className={'text-gray-500'}>Server Type</span>
                            <span className={'text-gray-600'}>Not selected</span>
                        </div>
                    ))}

                {/* Billing Cycle */}
                {selectedCycle ? (
                    <div className={'flex items-start justify-between text-sm'}>
                        <span className={'text-gray-400'}>Billing Cycle</span>
                        <div className={'flex flex-col items-end'}>
                            <span className={'text-gray-200 font-medium'}>
                                {selectedBillingDays} {selectedBillingDays === 1 ? 'day' : 'days'}
                            </span>
                            {hasDiscount && (
                                <span className={'text-xs text-green-400'}>
                                    {selectedCycle.discountPercent.toFixed(0)}% off
                                </span>
                            )}
                            {hasPremium && (
                                <span className={'text-xs text-red-400'}>
                                    +{Math.abs(selectedCycle.discountPercent).toFixed(0)}%
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className={'flex items-center justify-between text-sm'}>
                        <span className={'text-gray-500'}>Billing Cycle</span>
                        <span className={'text-gray-600'}>Not selected</span>
                    </div>
                )}
            </div>

            {/* Price Calculation */}
            {showDetailedBreakdown ? (
                <div className={'space-y-2 mb-4'}>
                    {/* Base Price */}
                    <div className={'flex items-center justify-between text-sm'}>
                        <span className={'text-gray-400'}>Base Price</span>
                        <span className={'text-gray-300'}>{formatPrice(basePrice)}</span>
                    </div>

                    {/* Billing Cycle Price */}
                    {selectedCycle && (
                        <div className={'flex items-center justify-between text-sm'}>
                            <div className={'flex flex-col'}>
                                <span className={'text-gray-400'}>{selectedBillingDays}-day cycle</span>
                                {hasDiscount && (
                                    <span className={'text-xs text-green-400'}>
                                        {selectedCycle.discountPercent.toFixed(0)}% off
                                    </span>
                                )}
                                {hasPremium && (
                                    <span className={'text-xs text-red-400'}>
                                        +{Math.abs(selectedCycle.discountPercent).toFixed(0)}% premium
                                    </span>
                                )}
                            </div>
                            <span
                                className={
                                    hasDiscount ? 'text-green-400' : hasPremium ? 'text-red-400' : 'text-gray-300'
                                }
                            >
                                {formatPrice(afterBillingCycle)}
                            </span>
                        </div>
                    )}

                    {/* Node Location Adjustment */}
                    {nodeMultiplier !== 1.0 && (
                        <div className={'flex items-center justify-between text-sm'}>
                            <div className={'flex flex-col'}>
                                <span className={'text-gray-400'}>Location Adjustment</span>
                                <span className={'text-xs text-gray-500'}>
                                    {nodePriceDifference >= 0 ? '+' : ''}
                                    {formatPrice(nodePriceDifference)}
                                </span>
                            </div>
                            <span
                                className={
                                    hasNodeDiscount
                                        ? 'text-green-400'
                                        : hasNodePremium
                                          ? 'text-red-400'
                                          : 'text-gray-300'
                                }
                            >
                                {formatPrice(afterNodeMultiplier)}
                            </span>
                        </div>
                    )}

                    {/* Subtotal */}
                    {(selectedCycle || nodeMultiplier !== 1.0) && (
                        <div className={'flex items-center justify-between text-sm pt-2 border-t border-gray-700'}>
                            <span className={'text-gray-300 font-medium'}>Subtotal</span>
                            <span className={'text-gray-200 font-medium'}>{formatPrice(subtotal)}</span>
                        </div>
                    )}

                    {/* Coupon Discount */}
                    {couponDiscount > 0 && couponCode && (
                        <div className={'flex items-center justify-between text-sm'}>
                            <span className={'text-gray-400'}>Coupon ({couponCode})</span>
                            <span className={'text-green-400 font-medium'}>-{formatPrice(couponDiscount)}</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className={'space-y-2 mb-4'}>
                    <div className={'flex items-center justify-between text-sm'}>
                        <span className={'text-gray-400'}>Subtotal</span>
                        <span className={'text-gray-200 font-medium'}>{formatPrice(subtotal)}</span>
                    </div>

                    {/* Coupon Discount */}
                    {couponDiscount > 0 && couponCode && (
                        <div className={'flex items-center justify-between text-sm'}>
                            <span className={'text-gray-400'}>Coupon ({couponCode})</span>
                            <span className={'text-green-400 font-medium'}>-{formatPrice(couponDiscount)}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Total */}
            <div className={'pt-4 border-t border-gray-700'}>
                <div className={'flex items-center justify-between'}>
                    <span className={'text-base font-bold text-gray-200'}>Total</span>
                    <span className={'text-2xl font-bold'} style={{ color: colors.primary }}>
                        {formatPrice(total)}
                    </span>
                </div>

                {/* Savings indicator - only show when coupon is applied */}
                {couponDiscount > MINIMUM_DISCOUNT_DISPLAY && (
                    <div className={'mt-2 text-center text-xs text-green-400'}>
                        You're saving {formatPrice(couponDiscount)}!
                    </div>
                )}
            </div>

            {/* Coupon Section - only show on review page when price is not zero */}
            {showCouponInput && basePrice !== 0 && (
                <div className={'mt-4 pt-4 border-t border-gray-700'}>
                    <button
                        onClick={() => setShowCoupon(!showCoupon)}
                        className={'mb-3 flex w-full items-center justify-between text-left transition-all'}
                        aria-label={showCoupon ? 'Hide coupon code input' : 'Show coupon code input'}
                        aria-expanded={showCoupon}
                    >
                        <h3 className={'text-sm font-semibold text-gray-200'}>
                            {showCoupon ? 'Coupon Code' : 'Have a coupon?'}
                        </h3>
                        <FontAwesomeIcon
                            icon={showCoupon ? faChevronDown : faChevronRight}
                            className={'h-3 w-3'}
                            style={{ color: colors.primary }}
                            aria-hidden={true}
                        />
                    </button>
                    {showCoupon && onCouponApplied && (
                        <div>
                            <CouponInput subtotal={subtotal} onCouponApplied={onCouponApplied} />
                            <FlashMessageRender byKey={'coupon'} className={'mt-2'} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
