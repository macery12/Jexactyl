import { useEffect, useState } from 'react';
import TitledGreyBox from '@/elements/TitledGreyBox';
import { ServerContext } from '@/state/server';
import { faExchangeAlt } from '@fortawesome/free-solid-svg-icons';
import useFlash from '@/plugins/useFlash';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Alert } from '@/elements/alert';
import { Product } from '@definitions/account/billing';
import {
    getAvailablePlans,
    validatePlanChange,
    changePlan,
    PlanChangeValidation,
    BillingCycleWithPrice,
    getBillingCyclesForProduct,
} from '@/api/routes/server/billing';
import { Button } from '@/elements/button';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';
import { Dialog } from '@/elements/dialog';
import Label from '@/elements/Label';

export default () => {
    const [plans, setPlans] = useState<Product[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [changing, setChanging] = useState<boolean>(false);
    const [selectedPlan, setSelectedPlan] = useState<Product | null>(null);
    const [validation, setValidation] = useState<PlanChangeValidation | null>(null);
    const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false);
    const [billingCycles, setBillingCycles] = useState<BillingCycleWithPrice[]>([]);
    const [selectedBillingDays, setSelectedBillingDays] = useState<number | null>(null);
    const [loadingCycles, setLoadingCycles] = useState<boolean>(false);

    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const settings = useStoreState(s => s.everest.data!.billing);
    const { colors } = useStoreState(s => s.theme.data!);
    const serverUuid = ServerContext.useStoreState(s => s.server.data!.uuid);
    const billingProductId = ServerContext.useStoreState(s => s.server.data!.billingProductId);
    const currentBillingDays = ServerContext.useStoreState(s => s.server.data!.billingDays);

    // Use current billing cycle or default from settings
    const defaultBillingDays = currentBillingDays || settings.renewal?.default_billing_days || 30;

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

    // Calculate price for a plan based on billing cycle
    const calculatePlanPrice = (plan: Product, billingDays?: number): { price: number; discount: number } => {
        const basePrice = plan.basePrice || plan.price;
        const days = billingDays || defaultBillingDays;
        const perDayPrice = basePrice / defaultBillingDays;

        // Find matching multiplier step
        let multiplier = 1.0;
        let matchedStep = false;
        if (multiplierSteps.length > 0) {
            const sortedSteps = [...multiplierSteps].sort((a: any, b: any) => a.maxDays - b.maxDays);
            for (const step of sortedSteps) {
                if (days <= step.maxDays) {
                    multiplier = step.multiplier;
                    matchedStep = true;
                    break;
                }
            }
            // If no match found, use last step's multiplier
            if (!matchedStep) {
                multiplier = sortedSteps[sortedSteps.length - 1]?.multiplier || 1.0;
            }
        }

        const finalPrice = perDayPrice * days * multiplier;
        const standardPrice = perDayPrice * days;
        const discountPercent = standardPrice > 0 ? ((standardPrice - finalPrice) / standardPrice) * 100 : 0;

        return {
            price: Math.round(finalPrice * 100) / 100,
            discount: Math.round(discountPercent * 10) / 10,
        };
    };

    useEffect(() => {
        clearFlashes('server:billing:plan-change');

        if (billingProductId) {
            getAvailablePlans(serverUuid)
                .then(data => setPlans(data))
                .then(() => setLoading(false))
                .catch(error => {
                    setLoading(false);
                    clearAndAddHttpError({ key: 'server:billing:plan-change', error });
                });
        } else {
            setLoading(false);
        }
    }, []);

    const handlePlanSelect = async (plan: Product) => {
        setSelectedPlan(plan);
        setValidation(null);
        setBillingCycles([]);
        setSelectedBillingDays(null);
        clearFlashes('server:billing:plan-change');

        try {
            const result = await validatePlanChange(serverUuid, plan.id);
            setValidation(result);

            if (result.valid) {
                // Fetch billing cycles for the selected plan
                setLoadingCycles(true);
                try {
                    const cycles = await getBillingCyclesForProduct(plan.id);
                    setBillingCycles(cycles);

                    // Auto-select the default or current billing cycle
                    if (cycles.length > 0) {
                        const defaultCycle = cycles.find(c => c.is_default) || cycles[0];
                        setSelectedBillingDays(defaultCycle!.days);
                    }
                } catch (error) {
                    console.error('Failed to fetch billing cycles:', error);
                    // Continue anyway - use default billing days as fallback
                    setSelectedBillingDays(defaultBillingDays);
                } finally {
                    setLoadingCycles(false);
                }

                setShowConfirmDialog(true);
            }
        } catch (error) {
            clearAndAddHttpError({ key: 'server:billing:plan-change', error });
        }
    };

    const handleConfirmChange = async () => {
        if (!selectedPlan || selectedBillingDays === null) return;

        setChanging(true);
        clearFlashes('server:billing:plan-change');

        try {
            await changePlan(serverUuid, selectedPlan.id, selectedBillingDays);
            // Reload the page to reflect the new plan and resource limits
            // This ensures the server context and all components are refreshed
            window.location.reload();
        } catch (error) {
            clearAndAddHttpError({ key: 'server:billing:plan-change', error });
            setChanging(false);
            setShowConfirmDialog(false);
        }
    };

    if (!billingProductId) {
        return null;
    }

    if (loading) {
        return (
            <TitledGreyBox title={'Available Plans'} icon={faExchangeAlt}>
                <SpinnerOverlay visible={loading} />
                <p css={tw`text-gray-400 text-sm`}>Loading available plans...</p>
            </TitledGreyBox>
        );
    }

    if (plans.length === 0) {
        return null;
    }

    return (
        <>
            <TitledGreyBox title={'Available Plans'} icon={faExchangeAlt}>
                <div>
                    <p css={tw`text-gray-400 text-xs mb-2`}>Upgrade or downgrade to a different plan.</p>

                    <div css={tw`space-y-1.5`}>
                        {plans.map(plan => {
                            const { price, discount } = calculatePlanPrice(plan);

                            return (
                                <div key={plan.id} css={tw`relative`}>
                                    <div
                                        css={tw`flex items-center justify-between p-2.5 rounded transition-colors border border-transparent hover:border-gray-500`}
                                        style={{ backgroundColor: colors.secondary }}
                                    >
                                        <div css={tw`flex-1 min-w-0 mr-3`}>
                                            <div css={tw`flex items-baseline gap-2 mb-0.5`}>
                                                <h4 css={tw`text-sm font-medium text-gray-200`}>{plan.name}</h4>
                                                <span css={tw`text-xs font-semibold text-gray-300`}>
                                                    {settings.currency.symbol}
                                                    {price.toFixed(2)}
                                                </span>
                                                {discount !== 0 && (
                                                    <span css={tw`text-xs text-green-400`}>
                                                        ({Math.abs(discount).toFixed(1)}%{' '}
                                                        {discount > 0 ? 'discount' : 'premium'})
                                                    </span>
                                                )}
                                            </div>
                                            <div css={tw`flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-gray-400`}>
                                                <span>{plan.limits.cpu}% CPU</span>
                                                <span>{plan.limits.memory} MB RAM</span>
                                                <span>{plan.limits.disk} MB Disk</span>
                                                <span>{plan.limits.database} DB</span>
                                                <span>{plan.limits.backup} Backups</span>
                                                <span>
                                                    {plan.limits.subdomain === null ||
                                                    plan.limits.subdomain === undefined
                                                        ? 'Unlimited Subdomains'
                                                        : `${plan.limits.subdomain} Subdomains`}
                                                </span>
                                            </div>
                                        </div>
                                        <Button onClick={() => handlePlanSelect(plan)} disabled={changing} size="sm">
                                            Select
                                        </Button>
                                    </div>
                                    {selectedPlan?.id === plan.id && validation && !validation.valid && (
                                        <Alert type={'danger'} className={'mt-1.5'}>
                                            <p css={tw`text-xs font-medium mb-0.5`}>
                                                Cannot downgrade - usage exceeds limits:
                                            </p>
                                            <ul css={tw`text-xs space-y-0.5 ml-3`}>
                                                {Object.entries(validation.violations || {}).map(([resource, data]) => (
                                                    <li key={resource}>
                                                        {resource}: {data.current} {data.unit} → {data.limit}{' '}
                                                        {data.unit}
                                                    </li>
                                                ))}
                                            </ul>
                                        </Alert>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </TitledGreyBox>

            {/* Confirmation Dialog */}
            <Dialog
                open={showConfirmDialog}
                onClose={() => setShowConfirmDialog(false)}
                title="Confirm Plan Change"
                description={selectedPlan ? `Change to ${selectedPlan.name}?` : ''}
            >
                {selectedPlan &&
                    (() => {
                        const selectedCycle = billingCycles.find(c => c.days === selectedBillingDays);
                        const fallbackPricing = !selectedCycle
                            ? calculatePlanPrice(selectedPlan, selectedBillingDays ?? undefined)
                            : null;
                        const price = selectedCycle?.price ?? fallbackPricing!.price;
                        const discount = selectedCycle?.discount_percent ?? fallbackPricing!.discount;

                        return (
                            <>
                                <div css={tw`space-y-3`}>
                                    {/* Billing Cycle Selection */}
                                    {billingCycles.length > 0 && (
                                        <div>
                                            <Label>Billing Cycle</Label>
                                            {loadingCycles ? (
                                                <div css={tw`text-sm text-gray-400`}>Loading billing cycles...</div>
                                            ) : (
                                                <div css={tw`space-y-1.5 mt-1`}>
                                                    {billingCycles.map(cycle => (
                                                        <button
                                                            key={cycle.days}
                                                            onClick={() => setSelectedBillingDays(cycle.days)}
                                                            css={[
                                                                tw`w-full text-left p-2.5 rounded transition-all border`,
                                                                selectedBillingDays === cycle.days
                                                                    ? tw`border-blue-500 bg-blue-500 bg-opacity-10`
                                                                    : tw`border-gray-600 hover:border-gray-500`,
                                                            ]}
                                                            style={{
                                                                backgroundColor:
                                                                    selectedBillingDays === cycle.days
                                                                        ? undefined
                                                                        : colors.secondary,
                                                            }}
                                                            type="button"
                                                        >
                                                            <div css={tw`flex justify-between items-center`}>
                                                                <div css={tw`flex items-center gap-2`}>
                                                                    <span css={tw`text-sm font-medium text-gray-200`}>
                                                                        {cycle.days} days
                                                                    </span>
                                                                    {cycle.is_default && (
                                                                        <span
                                                                            css={tw`text-xs px-1.5 py-0.5 rounded bg-blue-500 bg-opacity-20 text-blue-400`}
                                                                        >
                                                                            Default
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div css={tw`flex items-baseline gap-1.5`}>
                                                                    <span css={tw`text-sm font-semibold text-gray-300`}>
                                                                        {settings.currency.symbol}
                                                                        {cycle.price.toFixed(2)}
                                                                    </span>
                                                                    {cycle.discount_percent !== 0 && (
                                                                        <span
                                                                            css={[
                                                                                tw`text-xs`,
                                                                                cycle.discount_percent > 0
                                                                                    ? tw`text-green-400`
                                                                                    : tw`text-red-400`,
                                                                            ]}
                                                                        >
                                                                            {cycle.discount_percent > 0 ? '-' : '+'}
                                                                            {Math.abs(cycle.discount_percent).toFixed(
                                                                                0,
                                                                            )}
                                                                            %
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Resource Details */}
                                    <div>
                                        <Label>New Resources</Label>
                                        <div css={tw`text-sm text-gray-300 space-y-1`}>
                                            <div css={tw`flex justify-between`}>
                                                <span>CPU:</span>
                                                <span>{selectedPlan.limits.cpu}%</span>
                                            </div>
                                            <div css={tw`flex justify-between`}>
                                                <span>RAM:</span>
                                                <span>{selectedPlan.limits.memory} MB</span>
                                            </div>
                                            <div css={tw`flex justify-between`}>
                                                <span>Disk:</span>
                                                <span>{selectedPlan.limits.disk} MB</span>
                                            </div>
                                            <div css={tw`flex justify-between`}>
                                                <span>Databases:</span>
                                                <span>{selectedPlan.limits.database}</span>
                                            </div>
                                            <div css={tw`flex justify-between`}>
                                                <span>Backups:</span>
                                                <span>{selectedPlan.limits.backup}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Price Summary */}
                                    <div>
                                        <Label>Price</Label>
                                        <div css={tw`flex items-baseline gap-2`}>
                                            <span css={tw`text-lg font-semibold text-gray-200`}>
                                                {settings.currency.symbol}
                                                {price.toFixed(2)}
                                            </span>
                                            <span css={tw`text-sm text-gray-400`}>
                                                {settings.currency.code.toUpperCase()}
                                            </span>
                                            {discount !== 0 && (
                                                <span
                                                    css={[
                                                        tw`text-xs font-medium`,
                                                        discount > 0 ? tw`text-green-400` : tw`text-red-400`,
                                                    ]}
                                                >
                                                    ({Math.abs(discount).toFixed(1)}%{' '}
                                                    {discount > 0 ? 'discount' : 'premium'})
                                                </span>
                                            )}
                                        </div>
                                        {selectedBillingDays && (
                                            <p css={tw`text-xs text-gray-500 mt-0.5`}>
                                                Billed every {selectedBillingDays} days
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <Alert type={'info'} className={'mt-4'}>
                                    <p css={tw`text-xs`}>
                                        Resources and billing cycle will be updated immediately. The page will reload
                                        after the change.
                                    </p>
                                </Alert>
                            </>
                        );
                    })()}
                <Dialog.Footer>
                    <Button.Text onClick={() => setShowConfirmDialog(false)} disabled={changing}>
                        Cancel
                    </Button.Text>
                    <Button onClick={handleConfirmChange} disabled={changing || loadingCycles}>
                        {changing ? 'Changing...' : 'Confirm'}
                    </Button>
                </Dialog.Footer>
            </Dialog>
        </>
    );
};
