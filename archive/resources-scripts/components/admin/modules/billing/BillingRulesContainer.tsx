import { useState } from 'react';
import { nanoid } from 'nanoid';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { useStoreActions, useStoreState } from '@/state/hooks';
import {
    faCalendar,
    faDollarSign,
    faPlus,
    faTrash,
    faMapMarkerAlt,
    faInfoCircle,
    faCalculator,
} from '@fortawesome/free-solid-svg-icons';
import Label from '@/elements/Label';
import Input from '@/elements/Input';
import { updateSettings } from '@/api/routes/admin/billing';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import { Alert } from '@/elements/alert';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import tw from 'twin.macro';
import NodePricingManager from './NodePricingManager';

type TabType = 'billing-cycles' | 'node-pricing';

const EPSILON = 0.001;
const MIN_MULTIPLIER = 0.1;
const MAX_MULTIPLIER = 10;
const MIN_BILLING_DAYS = 1;
const MAX_BILLING_DAYS = 360;

type ClampTag = 'MIN' | 'MAX';

const isMultiplierInRange = (value: number): boolean => value >= MIN_MULTIPLIER && value <= MAX_MULTIPLIER;
const clampMultiplier = (value: number): { value: number; clamped?: ClampTag } => {
    if (value < MIN_MULTIPLIER) return { value: MIN_MULTIPLIER, clamped: 'MIN' };
    if (value > MAX_MULTIPLIER) return { value: MAX_MULTIPLIER, clamped: 'MAX' };
    return { value, clamped: undefined };
};
const clampBillingDays = (value: number): { value: number; clamped?: ClampTag } => {
    if (value < MIN_BILLING_DAYS) return { value: MIN_BILLING_DAYS, clamped: 'MIN' };
    if (value > MAX_BILLING_DAYS) return { value: MAX_BILLING_DAYS, clamped: 'MAX' };
    return { value, clamped: undefined };
};

interface MultiplierStep {
    id: string;
    maxDays: number;
    maxDaysInput?: string;
    multiplier: number;
    multiplierInput?: string;
}

type StoredMultiplierStep = Omit<MultiplierStep, 'id'>;

const formatPriceAdjustment = (multiplier: number, clamped?: ClampTag): string => {
    // Use epsilon comparison for floating point
    if (Math.abs(multiplier - 1.0) < EPSILON) return 'Standard price';
    const percentage = Math.round((multiplier - 1) * 100);
    if (percentage > 0) return `+${percentage}%${clamped ? ` (${clamped})` : ''}`;
    return `${percentage}%${clamped ? ` (${clamped})` : ''}`;
};

export const normalizeMultiplierValue = (raw: string): { value: number; clamped?: ClampTag } => {
    const trimmed = raw.trim();
    const parsed = parseFloat(trimmed);

    if (!trimmed || Number.isNaN(parsed)) {
        throw new Error('Price adjustment must be a valid number.');
    }

    if (!isMultiplierInRange(parsed)) {
        return clampMultiplier(parsed);
    }

    return { value: parsed, clamped: undefined };
};

export const normalizeBillingDaysValue = (raw: string | number): { value: number; clamped?: ClampTag } => {
    const trimmed = typeof raw === 'number' ? raw.toString() : raw.trim();
    const parsed = parseInt(trimmed, 10);

    if (!trimmed || Number.isNaN(parsed)) {
        throw new Error('Billing length must be a valid number of days.');
    }

    const clamped = clampBillingDays(parsed);
    return { value: clamped.value, clamped: clamped.clamped };
};

const formatBillingLength = (
    maxDays: number,
    isLast: boolean,
    defaultBillingDays: number,
    clamped?: ClampTag,
): string => {
    const suffix = clamped ? ` (${clamped})` : '';
    if (maxDays === defaultBillingDays) return `${maxDays} days (base)${suffix}`;
    if (isLast) return `${maxDays}+ days${suffix}`;
    return `Up to ${maxDays} days${suffix}`;
};

export default () => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const updateEverest = useStoreActions(s => s.everest.updateEverest);
    const theme = useStoreState(s => s.theme.data!);
    const { clearFlashes, addFlash } = useFlash();

    const [activeTab, setActiveTab] = useState<TabType>('billing-cycles');
    const [defaultBillingDays, setDefaultBillingDays] = useState<number>(settings.renewal?.default_billing_days || 30);

    // Parse multiplier steps from settings or use defaults
    const parseSteps = (stepsString: string | undefined): MultiplierStep[] => {
        if (!stepsString) {
            return [
                { id: nanoid(), maxDays: 10, maxDaysInput: '10', multiplier: 1.3, multiplierInput: '1.30' },
                { id: nanoid(), maxDays: 20, maxDaysInput: '20', multiplier: 1.2, multiplierInput: '1.20' },
                { id: nanoid(), maxDays: 29, maxDaysInput: '29', multiplier: 1.1, multiplierInput: '1.10' },
                { id: nanoid(), maxDays: 30, maxDaysInput: '30', multiplier: 1.0, multiplierInput: '1.00' },
                { id: nanoid(), maxDays: 59, maxDaysInput: '59', multiplier: 0.95, multiplierInput: '0.95' },
                { id: nanoid(), maxDays: 89, maxDaysInput: '89', multiplier: 0.9, multiplierInput: '0.90' },
                { id: nanoid(), maxDays: 999, maxDaysInput: '999', multiplier: 0.85, multiplierInput: '0.85' },
            ];
        }
        try {
            const parsed = JSON.parse(stepsString) as StoredMultiplierStep[];
            // Add IDs to existing steps if they don't have them
            return parsed.map(step => ({
                ...step,
                id: nanoid(),
                maxDaysInput: step.maxDays.toString(),
                multiplierInput: step.multiplier.toFixed(2),
            }));
        } catch {
            return [];
        }
    };

    const [multiplierSteps, setMultiplierSteps] = useState<MultiplierStep[]>(
        parseSteps(settings.renewal?.multiplier_steps as string | undefined),
    );
    const [loading, setLoading] = useState(false);

    const addStep = () => {
        setMultiplierSteps([
            ...multiplierSteps,
            { id: nanoid(), maxDays: 1, maxDaysInput: '0', multiplier: 1.0, multiplierInput: '1.00' },
        ]);
    };

    const removeStep = (id: string) => {
        setMultiplierSteps(multiplierSteps.filter(step => step.id !== id));
    };

    const updateMaxDays = (id: string, value: string) => {
        const updated = multiplierSteps.map(step => {
            if (step.id !== id) return step;
            const trimmed = value.trim();
            const parsed = parseInt(trimmed, 10);
            const clamped = Number.isNaN(parsed) ? clampBillingDays(step.maxDays) : clampBillingDays(parsed);

            return {
                ...step,
                maxDaysInput: value,
                maxDays: clamped.value,
            };
        });
        setMultiplierSteps(updated);
    };

    const updateMultiplierInput = (id: string, value: string) => {
        const updated = multiplierSteps.map(step => {
            if (step.id !== id) return step;
            const trimmed = value.trim();
            const parsed = parseFloat(trimmed);
            const clamped = Number.isNaN(parsed) ? undefined : clampMultiplier(parsed);

            return {
                ...step,
                multiplierInput: value,
                multiplier: clamped?.value ?? step.multiplier,
            };
        });
        setMultiplierSteps(updated);
    };

    const getDisplayMultiplier = (step: MultiplierStep): { effective: number; clampTag?: ClampTag } => {
        const raw = step.multiplierInput ?? step.multiplier?.toString() ?? '';
        const trimmed = raw.trim();
        const parsed = parseFloat(trimmed);

        if (!trimmed || Number.isNaN(parsed)) {
            const clamped = clampMultiplier(step.multiplier);
            return { effective: clamped.value, clampTag: clamped.clamped };
        }

        const clamped = clampMultiplier(parsed);
        return { effective: clamped.value, clampTag: clamped.clamped };
    };

    const getDisplayMaxDays = (step: MultiplierStep): { effective: number; clampTag?: ClampTag } => {
        const raw = step.maxDaysInput ?? step.maxDays?.toString() ?? '';
        const trimmed = raw.trim();
        const parsed = parseInt(trimmed, 10);

        if (!trimmed || Number.isNaN(parsed)) {
            const clamped = clampBillingDays(step.maxDays);
            return { effective: clamped.value, clampTag: clamped.clamped };
        }

        const clamped = clampBillingDays(parsed);
        return { effective: clamped.value, clampTag: clamped.clamped };
    };

    const handleSaveAll = async () => {
        clearFlashes('admin:billing');
        setLoading(true);

        try {
            // Validate steps
            if (multiplierSteps.length === 0) {
                throw new Error('At least one multiplier step is required');
            }

            // Sort steps by maxDays for consistency
            const sortedSteps = [...multiplierSteps].sort((a, b) => a.maxDays - b.maxDays);

            const validatedSteps = sortedSteps.map((step, idx) => {
                let normalizedMultiplier: { value: number; clamped?: ClampTag };
                let normalizedMaxDays: { value: number; clamped?: ClampTag };
                try {
                    normalizedMultiplier = normalizeMultiplierValue(
                        step.multiplierInput ?? step.multiplier?.toString() ?? '',
                    );
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Invalid price adjustment.';
                    throw new Error(`Step ${idx + 1} (${step.maxDays} days): ${message}`);
                }

                try {
                    normalizedMaxDays = normalizeBillingDaysValue(step.maxDaysInput ?? step.maxDays?.toString() ?? '');
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Invalid billing length.';
                    throw new Error(`Step ${idx + 1}: ${message}`);
                }

                return {
                    ...step,
                    maxDays: normalizedMaxDays.value,
                    maxDaysInput: normalizedMaxDays.value.toString(),
                    multiplier: normalizedMultiplier.value,
                    multiplierInput: normalizedMultiplier.value.toFixed(2),
                };
            });

            // Remove IDs before saving (backend doesn't need them)
            const stepsToSave = validatedSteps.map(step => ({
                maxDays: step.maxDays,
                multiplier: step.multiplier,
            }));

            // Save both settings
            await updateSettings('renewal:default_billing_days', defaultBillingDays);
            await updateSettings('renewal:multiplier_steps', JSON.stringify(stepsToSave));

            // Update state with all new values
            updateEverest({
                billing: {
                    ...settings,
                    renewal: {
                        ...settings.renewal,
                        default_billing_days: defaultBillingDays,
                        multiplier_steps: JSON.stringify(stepsToSave),
                    },
                },
            });

            setMultiplierSteps(validatedSteps);

            addFlash({
                key: 'admin:billing',
                type: 'success',
                message: 'Billing rules updated successfully.',
            });
        } catch (error) {
            console.error(error);
            addFlash({
                key: 'admin:billing',
                type: 'error',
                message: error instanceof Error ? error.message : 'Failed to update billing rules.',
            });
        } finally {
            setLoading(false);
        }
    };

    // Display steps as entered; sorting now only occurs during save
    const stepsForDisplay = multiplierSteps;

    return (
        <div>
            <FlashMessageRender byKey={'admin:billing'} className={'mb-4'} />
            <FlashMessageRender byKey={'admin:billing:node-pricing'} className={'mb-4'} />

            <Alert type={'info'} className={'mb-4'}>
                <strong>Global Billing Settings:</strong> Configure pricing adjustments for billing cycle lengths and
                node locations. These settings apply to all products.
            </Alert>

            {/* Tabs Navigation */}
            <div
                css={tw`border-b border-neutral-700 rounded-t-lg mb-4`}
                style={{ backgroundColor: theme.colors.secondary }}
            >
                <div css={tw`flex gap-1 px-4`}>
                    <button
                        onClick={() => setActiveTab('billing-cycles')}
                        className={`border-b-2 px-6 py-4 text-sm font-medium transition-colors ${
                            activeTab === 'billing-cycles'
                                ? 'border-blue-500 text-white'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <FontAwesomeIcon icon={faCalendar} className="mr-2" />
                        Billing Cycles
                    </button>
                    <button
                        onClick={() => setActiveTab('node-pricing')}
                        className={`border-b-2 px-6 py-4 text-sm font-medium transition-colors ${
                            activeTab === 'node-pricing'
                                ? 'border-blue-500 text-white'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <FontAwesomeIcon icon={faMapMarkerAlt} className="mr-2" />
                        Node Pricing
                    </button>
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'billing-cycles' && (
                <div>
                    {/* Save Button - Positioned under tab header */}
                    <div className={'mb-4 flex justify-end'}>
                        <Button onClick={handleSaveAll} disabled={loading}>
                            {loading ? 'Saving...' : 'Save Billing Cycle Settings'}
                        </Button>
                    </div>

                    <div className={'mb-4 grid gap-4 lg:grid-cols-2'}>
                        <AdminBox title={'Default Billing Length'} icon={faCalendar}>
                            <p className={'mb-4 text-gray-400'}>
                                The base billing cycle length used for pricing calculations.
                            </p>
                            <div>
                                <Label>Default Billing Days</Label>
                                <Input
                                    type={'number'}
                                    min={1}
                                    max={365}
                                    value={defaultBillingDays}
                                    onChange={e => setDefaultBillingDays(parseInt(e.target.value) || 30)}
                                    disabled={loading}
                                />
                                <p className={'mt-2 text-xs text-gray-500'}>
                                    Base reference for billing cycle calculations (typically 30 days).
                                </p>
                            </div>
                        </AdminBox>

                        <AdminBox title={'Pricing Rules Summary'} icon={faInfoCircle}>
                            <div className={'space-y-4 text-sm'}>
                                <div>
                                    <h4 className={'mb-2 flex items-center gap-2 font-medium text-gray-300'}>
                                        <FontAwesomeIcon icon={faCalculator} className={'text-blue-400'} />
                                        How Multipliers Work
                                    </h4>
                                    <p className={'text-xs text-gray-400'}>
                                        Billing cycle multipliers adjust pricing based on subscription length. The
                                        system finds the first step where the billing days are ≤ maxDays and applies
                                        that multiplier to the base price.
                                    </p>
                                </div>

                                <div className={'space-y-2'}>
                                    <div
                                        className={
                                            'flex items-center justify-between rounded border-l-4 border-red-500/50 bg-red-500/10 px-3 py-2'
                                        }
                                    >
                                        <span className={'text-gray-300'}>Short cycles (≤14 days)</span>
                                        <span className={'font-semibold text-red-400'}>Premium +20-30%</span>
                                    </div>
                                    <div
                                        className={
                                            'flex items-center justify-between rounded border-l-4 border-blue-500/50 bg-blue-500/10 px-3 py-2'
                                        }
                                    >
                                        <span className={'text-gray-300'}>Standard (30 days)</span>
                                        <span className={'font-semibold text-blue-400'}>Base Price 1.00x</span>
                                    </div>
                                    <div
                                        className={
                                            'flex items-center justify-between rounded border-l-4 border-green-500/50 bg-green-500/10 px-3 py-2'
                                        }
                                    >
                                        <span className={'text-gray-300'}>Long cycles (90+ days)</span>
                                        <span className={'font-semibold text-green-400'}>Discount -10-15%</span>
                                    </div>
                                </div>

                                <div className={'rounded border border-blue-500/20 bg-blue-500/5 p-3'}>
                                    <h5 className={'mb-1 text-xs font-medium text-blue-300'}>Example Calculation</h5>
                                    <p className={'text-xs text-gray-400'}>
                                        A $10/month product with a 60-day billing cycle (0.95x multiplier):
                                        <br />
                                        <span className={'mt-1 block font-mono text-gray-300'}>
                                            $10.00 × 2 months × 0.95 = ${(10 * 2 * 0.95).toFixed(2)}
                                        </span>
                                    </p>
                                </div>
                            </div>
                        </AdminBox>
                    </div>

                    <AdminBox title={'Price Adjustment Steps'} icon={faDollarSign}>
                        <p className={'mb-4 text-gray-400'}>
                            Define tiered pricing adjustments based on billing cycle length. Longer billing cycles
                            typically receive discounts.
                        </p>

                        {/* Price Adjustment Table */}
                        <div css={tw`overflow-x-auto mb-4`}>
                            <table css={tw`w-full border-collapse`}>
                                <thead>
                                    <tr css={tw`border-b-2 border-neutral-600`}>
                                        <th css={tw`text-left py-3 px-4 text-neutral-300 font-semibold`}>
                                            Billing Length
                                        </th>
                                        <th css={tw`text-left py-3 px-4 text-neutral-300 font-semibold`}>
                                            Price Adjustment
                                        </th>
                                        <th css={tw`text-right py-3 px-4 text-neutral-300 font-semibold`}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stepsForDisplay.map((step, idx) => {
                                        const isLast = idx === stepsForDisplay.length - 1;
                                        const displayMultiplier = getDisplayMultiplier(step);
                                        const displayMaxDays = getDisplayMaxDays(step);
                                        return (
                                            <tr
                                                key={step.id}
                                                css={tw`border-b border-neutral-700 hover:bg-neutral-700 transition-colors`}
                                            >
                                                <td css={tw`py-3 px-4`}>
                                                    <div css={tw`flex items-center gap-2`}>
                                                        <span css={tw`text-neutral-300 min-w-[150px]`}>
                                                            {formatBillingLength(
                                                                displayMaxDays.effective,
                                                                isLast,
                                                                defaultBillingDays,
                                                                displayMaxDays.clampTag,
                                                            )}
                                                        </span>
                                                        <Input
                                                            type={'number'}
                                                            min={MIN_BILLING_DAYS}
                                                            max={MAX_BILLING_DAYS}
                                                            value={
                                                                step.maxDaysInput ??
                                                                step.maxDays?.toString() ??
                                                                defaultBillingDays.toString()
                                                            }
                                                            onChange={e => updateMaxDays(step.id, e.target.value)}
                                                            disabled={loading}
                                                            css={tw`w-24`}
                                                        />
                                                    </div>
                                                </td>
                                                <td css={tw`py-3 px-4`}>
                                                    <div css={tw`flex items-center gap-2`}>
                                                        <span
                                                            css={[
                                                                tw`min-w-[120px] font-medium`,
                                                                Math.abs(displayMultiplier.effective - 1.0) < EPSILON &&
                                                                    tw`text-blue-400`,
                                                                displayMultiplier.effective >= 1.0 + EPSILON &&
                                                                    tw`text-red-400`,
                                                                displayMultiplier.effective < 1.0 - EPSILON &&
                                                                    tw`text-green-400`,
                                                            ]}
                                                        >
                                                            {formatPriceAdjustment(
                                                                displayMultiplier.effective,
                                                                displayMultiplier.clampTag,
                                                            )}
                                                        </span>
                                                        <Input
                                                            type={'number'}
                                                            step={0.01}
                                                            min={MIN_MULTIPLIER}
                                                            max={MAX_MULTIPLIER}
                                                            value={
                                                                step.multiplierInput ??
                                                                step.multiplier?.toFixed(2) ??
                                                                '1.00'
                                                            }
                                                            onChange={e =>
                                                                updateMultiplierInput(step.id, e.target.value)
                                                            }
                                                            disabled={loading}
                                                            css={tw`w-24`}
                                                        />
                                                    </div>
                                                </td>
                                                <td css={tw`py-3 px-4 text-right`}>
                                                    <Button
                                                        type="button"
                                                        onClick={() => removeStep(step.id)}
                                                        className="!bg-red-500 hover:!bg-red-600"
                                                        disabled={loading || multiplierSteps.length === 1}
                                                    >
                                                        <FontAwesomeIcon icon={faTrash} />
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div css={tw`mt-4`}>
                            <Button type="button" onClick={addStep} disabled={loading}>
                                <FontAwesomeIcon icon={faPlus} className="mr-2" />
                                Add Step
                            </Button>
                        </div>

                        <Alert type={'info'} className={'mt-4'}>
                            <strong>How it works:</strong> The system finds the first step where days ≤ maxDays and
                            applies that multiplier. For example, a 15-day billing cycle would match the first step with
                            maxDays ≥ 15.
                        </Alert>
                    </AdminBox>
                </div>
            )}

            {activeTab === 'node-pricing' && (
                <div>
                    <NodePricingManager />
                </div>
            )}
        </div>
    );
};
