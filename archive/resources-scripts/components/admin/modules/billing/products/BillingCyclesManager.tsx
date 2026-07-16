import { useState } from 'react';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import Label from '@/elements/Label';
import Input from '@/elements/Input';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash, faPlus, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { Alert } from '@/elements/alert';
import { useStoreState } from '@/state/hooks';

interface BillingCycle {
    id?: number;
    days: number;
    isEnabled: boolean;
    price?: number;
}

interface BillingCyclesManagerProps {
    cycles: BillingCycle[];
    basePrice: number;
    onChange: (cycles: BillingCycle[]) => void;
}

const BillingCyclesManager = ({ cycles, basePrice, onChange }: BillingCyclesManagerProps) => {
    const [newCycleDays, setNewCycleDays] = useState<string>('');
    const [error, setError] = useState<string>('');
    const { colors } = useStoreState(state => state.theme.data!);
    const settings = useStoreState(state => state.everest.data!.billing);

    // Get multiplier steps and default billing days from settings
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
    const calculatePrice = (days: number): number => {
        const validatedBasePrice = basePrice || 0;
        const perDayPrice = validatedBasePrice / defaultBillingDays;

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
            if (!matchedStep && sortedSteps.length > 0) {
                multiplier = sortedSteps[sortedSteps.length - 1].multiplier;
            }
        }

        return Math.max(0, perDayPrice * days * multiplier);
    };

    const handleAddCycle = () => {
        setError('');
        const days = parseInt(newCycleDays);

        if (isNaN(days) || days < 1 || days > 365) {
            setError('Billing cycle must be between 1 and 365 days');
            return;
        }

        if (cycles.some(c => c.days === days)) {
            setError('A billing cycle with this duration already exists');
            return;
        }

        const newCycle: BillingCycle = {
            days,
            isEnabled: true,
        };

        onChange([...cycles, newCycle].sort((a, b) => a.days - b.days));
        setNewCycleDays('');
    };

    const handleToggleCycle = (index: number) => {
        const updated = [...cycles];
        updated[index] = { ...updated[index]!, isEnabled: !updated[index]!.isEnabled };
        onChange(updated);
    };

    const handleDeleteCycle = (index: number) => {
        const updated = cycles.filter((_, i) => i !== index);
        onChange(updated);
    };

    const getDiscountPercent = (days: number): number => {
        if (basePrice === 0 || days === defaultBillingDays) return 0;

        const actualPrice = calculatePrice(days);
        const equivalentMonthlyPrice = (actualPrice / days) * defaultBillingDays;

        // Return positive for discount, negative for premium
        return ((basePrice - equivalentMonthlyPrice) / basePrice) * 100;
    };

    return (
        <div>
            <div css={tw`mb-4`}>
                <Label>Add Billing Cycle</Label>
                <div css={tw`flex gap-2 items-start`}>
                    <div css={tw`flex-1`}>
                        <Input
                            type="number"
                            min={1}
                            max={365}
                            value={newCycleDays}
                            onChange={e => setNewCycleDays(e.target.value)}
                            placeholder="Days (1-365)"
                        />
                    </div>
                    <Button onClick={handleAddCycle} type="button">
                        <FontAwesomeIcon icon={faPlus} className="mr-2" />
                        Add
                    </Button>
                </div>
                {error && <p css={tw`text-red-400 text-xs mt-1`}>{error}</p>}
            </div>

            {cycles.length === 0 ? (
                <Alert type="info" className="mb-4">
                    <FontAwesomeIcon icon={faInfoCircle} className="mr-2" />
                    No billing cycles configured. The default 30-day cycle will be used.
                </Alert>
            ) : (
                <div css={tw`space-y-2`}>
                    {cycles.map((cycle, index) => {
                        const price = calculatePrice(cycle.days);
                        const discount = getDiscountPercent(cycle.days);

                        return (
                            <div
                                key={cycle.id || `new-${index}`}
                                css={tw`flex items-center gap-3 p-3 rounded`}
                                style={{ backgroundColor: colors.secondary }}
                            >
                                <input
                                    type="checkbox"
                                    checked={cycle.isEnabled}
                                    onChange={() => handleToggleCycle(index)}
                                    css={tw`w-4 h-4`}
                                />
                                <div css={tw`flex-1`}>
                                    <div css={tw`text-sm font-medium`}>
                                        {cycle.days} days
                                        {cycle.days === defaultBillingDays && (
                                            <span css={tw`ml-2 text-xs text-neutral-400`}>(Default)</span>
                                        )}
                                    </div>
                                    <div css={tw`text-xs text-neutral-400`}>
                                        ${price.toFixed(2)}
                                        {discount !== 0 && (
                                            <span css={tw`ml-2`}>
                                                ({Math.abs(discount).toFixed(1)}%{' '}
                                                {discount > 0 ? 'discount' : 'premium'})
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    onClick={() => handleDeleteCycle(index)}
                                    className="!bg-red-500 hover:!bg-red-600"
                                >
                                    <FontAwesomeIcon icon={faTrash} />
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}

            {cycles.length > 0 && (
                <div css={tw`mt-4 p-3 rounded`} style={{ backgroundColor: colors.secondary }}>
                    <div css={tw`text-xs text-neutral-400 mb-2`}>
                        <FontAwesomeIcon icon={faInfoCircle} className="mr-1" />
                        Price Calculation Preview
                    </div>
                    <div css={tw`text-xs space-y-1`}>
                        <div>
                            Base Price ({defaultBillingDays} days): ${basePrice.toFixed(2)}
                        </div>
                        {multiplierSteps.length > 0 && (
                            <div>
                                <div className="font-semibold mt-2">Multiplier Steps:</div>
                                <ul className="list-disc list-inside ml-2 mt-1">
                                    {multiplierSteps.map((step: any, idx: number) => (
                                        <li key={idx}>
                                            Days ≤ {step.maxDays}: {step.multiplier.toFixed(2)}x
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default BillingCyclesManager;
