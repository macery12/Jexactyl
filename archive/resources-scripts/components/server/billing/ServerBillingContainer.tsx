import { useEffect, useState } from 'react';
import Label from '@/elements/Label';
import { Link } from 'react-router-dom';
import TitledGreyBox from '@/elements/TitledGreyBox';
import { ServerContext } from '@/state/server';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faArrowRight,
    faClock,
    faCreditCard,
    faInfoCircle,
    faBox,
    faCalendarAlt,
    faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';
import useFlash from '@/plugins/useFlash';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Alert } from '@/elements/alert';
import PaymentContainer from './PaymentContainer';
import { useStoreState } from '@/state/hooks';
import PageContentBlock from '@/elements/PageContentBlock';
import { getProduct, getProductBillingCycles, BillingCycle } from '@/api/routes/account/billing/products';
import BillingCycleBox from '@account/billing/order/BillingCycleBox';
import { Product } from '@definitions/account/billing';
import { renewFreeServer } from '@/api/routes/account/billing/orders/process';
import { Button } from '@/elements/button';
import FlashMessageRender from '@/elements/FlashMessageRender';
import CouponInput from '@/components/account/billing/order/CouponInput';
import { ValidateCouponResponse } from '@/api/routes/account/billing/coupons';
import tw from 'twin.macro';
import ScopedAlert from '@/components/account/ScopedAlert';
import ChangePlanContainer from './ChangePlanContainer';

function timeUntil(targetDate: Date | string) {
    const date = targetDate instanceof Date ? targetDate : new Date(targetDate);

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    return {
        days: Math.floor(diffMs / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diffMs / (1000 * 60 * 60)) % 24),
    };
}

function getRenewalStatusBadge(
    daysRemaining: number,
    suspensionThreshold: number,
    daysOverdue: number,
    freeGraceDays: number,
) {
    if (daysRemaining < 0) {
        if (daysOverdue > freeGraceDays) {
            return { text: 'Overdue', color: 'bg-red-500', icon: faExclamationTriangle };
        }
        return { text: 'Grace Period', color: 'bg-yellow-500', icon: faClock };
    } else if (daysRemaining <= suspensionThreshold) {
        return { text: 'Renewal Available', color: 'bg-yellow-500', icon: faClock };
    }
    return { text: 'Active', color: 'bg-green-500', icon: faInfoCircle };
}

export default () => {
    const [product, setProduct] = useState<Product>();
    const [loading, setLoading] = useState<boolean>(true);
    const [renewing, setRenewing] = useState<boolean>(false);
    const [couponData, setCouponData] = useState<ValidateCouponResponse | null>(null);
    const [currentBillingCycle, setCurrentBillingCycle] = useState<BillingCycle | null>(null);
    const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
    const [selectedRenewalDays, setSelectedRenewalDays] = useState<number>(0);

    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const settings = useStoreState(s => s.everest.data!.billing);
    const serverId = ServerContext.useStoreState(s => s.server.data!.internalId);
    const serverUuid = ServerContext.useStoreState(s => s.server.data!.uuid);
    const billingProductId = ServerContext.useStoreState(s => s.server.data!.billingProductId);
    const renewalDate = ServerContext.useStoreState(s => s.server.data!.renewalDate);
    const billingDays = ServerContext.useStoreState(s => s.server.data!.billingDays);
    const serverStatus = ServerContext.useStoreState(s => s.server.data!.status);
    const isDeletionScheduled = ServerContext.useStoreState(s => s.server.data!.isDeletionScheduled ?? false);

    // Get configurable renewal settings
    // Use the actual billing days from the server if available, otherwise fall back to default renewalDays
    const actualBillingDays = billingDays || settings.renewal?.days || 30;
    const freeGraceDays = settings.renewal?.free_suspension_days || 7;
    const suspensionThreshold = settings.renewal?.suspension_threshold || 7;
    const settingsPath = `/server/${serverUuid}/settings`;
    const settingsLinkStyles = tw`inline-block rounded bg-gray-700 px-3 py-2 text-center text-sm font-medium text-gray-100 hover:bg-gray-600`;

    /**
     * Calculate grace period threshold in days based on billing cycle length.
     * Uses same logic as backend: min(max(billingDays * 20%, 3), 7)
     * - 7-day cycle → 3 days (minimum)
     * - 30-day cycle → 6 days
     * - 90-day cycle → 7 days (capped)
     * - 180+ day cycle → 7 days (capped)
     */
    const calculateGracePeriodDays = (days: number, isFree: boolean): number => {
        if (isFree) {
            return freeGraceDays;
        }

        const percentage = settings.renewal?.suspension_threshold_percentage || 0.2;
        const calculatedThreshold = Math.ceil(days * percentage);
        const minThreshold = settings.renewal?.min_suspension_threshold_days || 3;
        const maxThreshold = settings.renewal?.max_suspension_threshold_days || 7;

        return Math.max(minThreshold, Math.min(maxThreshold, calculatedThreshold));
    };

    // Calculate the actual grace period based on billing cycle
    const actualGracePeriod =
        product && billingDays
            ? calculateGracePeriodDays(billingDays, product.price === 0)
            : product && product.price === 0
              ? freeGraceDays
              : suspensionThreshold;

    useEffect(() => {
        clearFlashes();

        if (billingProductId) {
            getProduct(billingProductId)
                .then(data => {
                    setProduct(data);
                    // Load billing cycles to get the current cycle's price
                    return getProductBillingCycles(billingProductId);
                })
                .then(cycles => {
                    setBillingCycles(cycles ?? []);
                    // Find the billing cycle that matches the server's billing days
                    if (billingDays && cycles) {
                        const cycle = cycles.find(c => c.days === billingDays);
                        if (cycle) {
                            setCurrentBillingCycle(cycle);
                        }
                    }
                    // Default selected renewal days to current server billing days
                    setSelectedRenewalDays(billingDays ?? 0);
                    setLoading(false);
                })
                .catch(error => {
                    setLoading(false);
                    console.error(error);
                });
        }
    }, []);

    const handleFreeRenewal = () => {
        if (!product || !billingProductId) return;

        setRenewing(true);
        clearFlashes('server:billing');

        // Use renewFreeServer for free products and paid products made free by coupons
        // Pass the selected renewal days (allows cycle change at renewal)
        renewFreeServer(
            billingProductId,
            Number(serverId),
            couponData?.coupon.id,
            selectedRenewalDays > 0 ? selectedRenewalDays : billingDays != null ? Number(billingDays) : undefined,
        )
            .then(() => {
                // Force a full page reload to refresh the renewal date
                window.location.reload();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'server:billing', error });
                setRenewing(false);
            });
    };

    const handleCouponApplied = (data: ValidateCouponResponse | null) => {
        setCouponData(data);
    };

    // Calculate days remaining until renewal (can be negative if overdue)
    const daysRemaining = renewalDate ? timeUntil(renewalDate).days : 0;
    const daysOverdue = daysRemaining < 0 ? Math.abs(daysRemaining) : 0;

    // Determine if server is past the maximum suspension threshold and suspended
    // Use max_suspension_threshold_days (7 days) as the fixed cutoff for disabling self-service payment
    const maxSuspensionThresholdDays = settings.renewal?.max_suspension_threshold_days || 7;
    const isSuspended = serverStatus === 'suspended';
    const isPaymentDisabled = daysOverdue > maxSuspensionThresholdDays && isSuspended;

    const statusBadge = renewalDate
        ? getRenewalStatusBadge(daysRemaining, actualGracePeriod, daysOverdue, freeGraceDays)
        : null;

    return (
        <>
            <PageContentBlock
                title={'Server Billing'}
                header
                description={'Manage your server subscription, renewal, and billing settings.'}
            >
                <ScopedAlert scope="server" position="top-center" />
                <FlashMessageRender byKey={'server:billing'} css={tw`mb-4`} />
                {isDeletionScheduled && renewalDate && (
                    <Alert type={'danger'} className={'mb-4'}>
                        <div className={'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'}>
                            <div>
                                Scheduled for deletion on{' '}
                                {new Date(renewalDate).toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                })}{' '}
                                (end of day).
                            </div>
                            <Link to={settingsPath} css={settingsLinkStyles}>
                                Manage Scheduled Deletion in Settings
                            </Link>
                        </div>
                    </Alert>
                )}
                {!product && !loading && (
                    <Alert type={'warning'} className={'mb-6'}>
                        The product package you purchased initially no longer exists, so some details may not be shown.
                    </Alert>
                )}

                {/* Billing Overview Section */}
                <div css={tw`grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-4`}>
                    {/* Server Status Card */}
                    {renewalDate && (
                        <TitledGreyBox title={'Renewal Status'} icon={faClock}>
                            <SpinnerOverlay visible={loading} />
                            {statusBadge && (
                                <div css={tw`mb-4`}>
                                    <span
                                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white ${statusBadge.color}`}
                                    >
                                        <FontAwesomeIcon icon={statusBadge.icon} className={'mr-2'} />
                                        {statusBadge.text}
                                    </span>
                                </div>
                            )}
                            <div>
                                <Label>Next Renewal Date</Label>
                                <p css={tw`text-gray-300 font-medium mb-1`}>
                                    {new Date(renewalDate).toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                    })}
                                </p>
                                <p css={tw`text-gray-400 text-sm`}>
                                    <FontAwesomeIcon icon={faClock} css={tw`mr-1`} />
                                    {daysRemaining >= 0 ? (
                                        <>
                                            {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'},{' '}
                                            {timeUntil(renewalDate).hours}{' '}
                                            {timeUntil(renewalDate).hours === 1 ? 'hour' : 'hours'} remaining
                                        </>
                                    ) : (
                                        <>
                                            {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} overdue
                                        </>
                                    )}
                                </p>
                            </div>
                        </TitledGreyBox>
                    )}

                    {/* Package Information Card */}
                    <TitledGreyBox title={'Package Details'} icon={faBox}>
                        <SpinnerOverlay visible={loading} />
                        <div>
                            <Label>Current Package</Label>
                            <p css={tw`text-gray-300 font-medium mb-1`}>
                                {product?.name || (loading ? 'Loading...' : 'Unknown')}
                            </p>
                            {product?.description && <p css={tw`text-gray-400 text-xs mb-3`}>{product.description}</p>}
                        </div>
                        <div css={tw`mt-4`}>
                            <Label>Billing Cycle</Label>
                            <p css={tw`text-gray-400 text-sm`}>
                                <FontAwesomeIcon icon={faCalendarAlt} css={tw`mr-1`} />
                                Every {actualBillingDays} days
                            </p>
                        </div>
                    </TitledGreyBox>

                    {/* Pricing Card */}
                    <TitledGreyBox title={'Plan Cost'} icon={faCreditCard}>
                        <SpinnerOverlay visible={loading} />
                        <div>
                            <Label>Price</Label>
                            <p css={tw`text-3xl font-bold text-gray-200 mb-2`}>
                                {settings.currency.symbol}
                                {currentBillingCycle
                                    ? currentBillingCycle.price.toFixed(2)
                                    : product
                                      ? product.price
                                      : '...'}
                                <span css={tw`text-sm font-normal text-gray-400 ml-1`}>
                                    {settings.currency.code.toUpperCase()}
                                </span>
                            </p>
                            <p css={tw`text-gray-400 text-xs mb-3`}>per {actualBillingDays} day billing cycle</p>
                            {currentBillingCycle && currentBillingCycle.discountPercent !== 0 && (
                                <p
                                    css={tw`text-xs mb-3`}
                                    className={
                                        currentBillingCycle.discountPercent > 0 ? 'text-green-400' : 'text-red-400'
                                    }
                                >
                                    {currentBillingCycle.discountPercent > 0 ? (
                                        <>✓ {currentBillingCycle.discountPercent.toFixed(1)}% discount applied</>
                                    ) : (
                                        <>
                                            +{Math.abs(currentBillingCycle.discountPercent).toFixed(1)}% premium for
                                            shorter cycle
                                        </>
                                    )}
                                </p>
                            )}
                            <Link
                                to={'/account/billing/orders'}
                                css={tw`text-green-400 text-sm hover:text-green-300 transition-colors duration-150`}
                            >
                                View order history <FontAwesomeIcon icon={faArrowRight} css={tw`ml-1`} />
                            </Link>
                        </div>
                    </TitledGreyBox>
                </div>

                {!renewalDate && (
                    <Alert type={'warning'} className={'mb-4'}>
                        There is no present renewal date for your server. Please contact support if you believe this is
                        an error.
                    </Alert>
                )}

                {/* Action Cards Section - Renewal and Server Type Change */}
                <div css={tw`grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-4`}>
                    {/* Renewal Section */}
                    <TitledGreyBox title={'Server Renewal'} icon={faCreditCard}>
                        {isDeletionScheduled ? (
                            <div css={tw`space-y-3`}>
                                <Alert type={'warning'}>
                                    This server is scheduled for deletion. Manage or cancel from Server Settings.
                                </Alert>
                                <Link to={settingsPath} css={settingsLinkStyles}>
                                    Manage Scheduled Deletion in Settings
                                </Link>
                            </div>
                        ) : !product ? (
                            <Alert type={'danger'}>
                                The product package that the server was made with no longer exists. In order to renew
                                your server, you&apos;ll need to speak to an administrator.
                            </Alert>
                        ) : (
                            <>
                                {product.price === 0 ? (
                                    <div>
                                        <p css={tw`text-gray-300 text-xs mb-3`}>
                                            <FontAwesomeIcon icon={faInfoCircle} css={tw`mr-1`} />
                                            Free server - renewable {actualGracePeriod} days before expiration
                                        </p>
                                        {isPaymentDisabled ? (
                                            <Alert type={'danger'}>
                                                <strong>Server Suspended</strong> - Your server has been suspended for
                                                more than {maxSuspensionThresholdDays} days due to non-payment. Please
                                                create a support ticket to restore access. Self-service payment is no
                                                longer available.
                                            </Alert>
                                        ) : daysRemaining > actualGracePeriod ? (
                                            <Alert type={'info'}>
                                                Renewal available in {daysRemaining - actualGracePeriod} days.
                                            </Alert>
                                        ) : (
                                            <div>
                                                <p css={tw`text-gray-300 text-sm mb-3`}>
                                                    {daysRemaining >= 0 ? (
                                                        <>Renew for {actualBillingDays} more days.</>
                                                    ) : (
                                                        <>
                                                            Grace period: {daysOverdue}/{actualGracePeriod} days
                                                        </>
                                                    )}
                                                </p>
                                                {billingCycles.length > 1 && (
                                                    <div className={'mb-4'}>
                                                        <p css={tw`text-gray-400 text-xs mb-2`}>
                                                            Select renewal cycle:
                                                        </p>
                                                        <div className={'grid gap-2'}>
                                                            {billingCycles.map(cycle => (
                                                                <BillingCycleBox
                                                                    key={cycle.days}
                                                                    cycle={cycle}
                                                                    selected={
                                                                        selectedRenewalDays > 0
                                                                            ? selectedRenewalDays
                                                                            : (billingDays ?? 30)
                                                                    }
                                                                    setSelected={setSelectedRenewalDays}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                <Button
                                                    onClick={handleFreeRenewal}
                                                    disabled={renewing}
                                                    css={tw`w-full`}
                                                >
                                                    {renewing ? 'Renewing...' : 'Renew Server'}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        {isPaymentDisabled ? (
                                            <Alert type={'danger'}>
                                                <strong>Server Suspended</strong> - Your server has been suspended for
                                                more than {maxSuspensionThresholdDays} days due to non-payment. Please
                                                create a support ticket to restore access. Self-service payment is no
                                                longer available.
                                            </Alert>
                                        ) : (
                                            <>
                                                {/* Show coupon input for paid servers */}
                                                <div css={tw`mb-4`}>
                                                    <Label>Renewal Cost</Label>
                                                    {couponData ? (
                                                        <div>
                                                            <div css={tw`text-sm text-gray-400 line-through`}>
                                                                {settings.currency.symbol}
                                                                {couponData.subtotal.toFixed(2)}
                                                            </div>
                                                            <div css={tw`flex items-baseline gap-1 mb-1`}>
                                                                <span css={tw`text-2xl font-bold text-gray-200`}>
                                                                    {settings.currency.symbol}
                                                                    {couponData.total.toFixed(2)}
                                                                </span>
                                                                <span css={tw`text-xs text-gray-400`}>
                                                                    {settings.currency.code.toUpperCase()}
                                                                </span>
                                                            </div>
                                                            <div css={tw`text-xs font-medium text-green-400`}>
                                                                Save {settings.currency.symbol}
                                                                {couponData.discount.toFixed(2)}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <p css={tw`text-gray-300 text-sm`}>
                                                            {settings.currency.symbol}
                                                            {currentBillingCycle
                                                                ? currentBillingCycle.price.toFixed(2)
                                                                : product.price.toFixed(2)}{' '}
                                                            {settings.currency.code.toUpperCase()}
                                                        </p>
                                                    )}
                                                </div>

                                                <CouponInput
                                                    subtotal={
                                                        currentBillingCycle ? currentBillingCycle.price : product.price
                                                    }
                                                    onCouponApplied={handleCouponApplied}
                                                    orderType="ren"
                                                />
                                                <FlashMessageRender byKey={'coupon'} css={tw`mt-2`} />

                                                <div css={tw`mt-4`}>
                                                    {couponData?.total === 0 ? (
                                                        <div>
                                                            <p css={tw`text-green-400 text-sm mb-3`}>
                                                                🎉 Your coupon has made this renewal free!
                                                            </p>
                                                            <Button
                                                                onClick={handleFreeRenewal}
                                                                disabled={renewing}
                                                                css={tw`w-full`}
                                                            >
                                                                {renewing ? 'Renewing...' : 'Renew Server'}
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <PaymentContainer
                                                            id={Number(product.id)}
                                                            couponId={couponData?.coupon.id}
                                                            billingDays={
                                                                selectedRenewalDays > 0
                                                                    ? selectedRenewalDays
                                                                    : billingDays
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </TitledGreyBox>

                    {/* Plan Change Section */}
                    <ChangePlanContainer />
                </div>
            </PageContentBlock>
        </>
    );
};
