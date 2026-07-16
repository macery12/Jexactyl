import { useState, useEffect } from 'react';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { faMapMarkerAlt, faUndo, faRedo, faSave } from '@fortawesome/free-solid-svg-icons';
import Input, { Textarea } from '@/elements/Input';
import useFlash from '@/plugins/useFlash';
import { Alert } from '@/elements/alert';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import tw from 'twin.macro';
import {
    getNodePricing,
    batchUpdateNodePricing,
    resetNodePricing,
    resetAllNodePricing,
    NodePricing,
} from '@/api/routes/admin/billing/nodePricing';

const MAX_MULTIPLIER = 25;
const MAX_DESCRIPTION_LENGTH = 500;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const formatMultiplierDisplay = (multiplier: number): string => {
    if (multiplier === 1.0) return 'Standard (1.00x)';
    if (multiplier > 1.0) {
        const percentage = Math.round((multiplier - 1) * 100);
        return `+${percentage}% (${multiplier.toFixed(2)}x)`;
    }
    const percentage = Math.round((1 - multiplier) * 100);
    return `-${percentage}% (${multiplier.toFixed(2)}x)`;
};

const isValidMultiplierText = (value: string): boolean => {
    // Allow empty while typing, or numbers with optional single decimal point.
    // Examples allowed: "", "1", "1.", "1.2", "0.75", ".5"
    if (value === '') return true;
    return /^(\d+(\.\d*)?|\.\d*)$/.test(value);
};

const parseMultiplierOrNull = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const formatMultiplier = (n: number) => n.toFixed(2);

export default () => {
    const { clearFlashes, addFlash } = useFlash();
    const [nodes, setNodes] = useState<NodePricing[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Store as STRING so users can type decimals like "1." without it collapsing to "1"
    const [localMultipliers, setLocalMultipliers] = useState<Record<number, string>>({});
    const [localDescriptions, setLocalDescriptions] = useState<Record<number, string>>({});

    useEffect(() => {
        void loadNodePricing();
    }, []);

    const loadNodePricing = async () => {
        try {
            setLoading(true);
            const data = await getNodePricing();
            setNodes(data);

            const multipliers: Record<number, string> = {};
            const descriptions: Record<number, string> = {};
            data.forEach(node => {
                multipliers[node.id] = formatMultiplier(Number(node.price_multiplier));
                descriptions[node.id] = node.price_multiplier_description || '';
            });
            setLocalMultipliers(multipliers);
            setLocalDescriptions(descriptions);
        } catch (error) {
            console.error('Failed to load node pricing:', error);
            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'error',
                message: 'Failed to load node pricing data.',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleMultiplierChange = (nodeId: number, value: string) => {
        // Block non-numeric patterns (letters, multiple decimals, etc.)
        if (!isValidMultiplierText(value)) return;

        // Allow in-progress states like "", ".", "1." with no range enforcement yet.
        const parsed = parseMultiplierOrNull(value);
        if (parsed !== null) {
            // Range enforcement while typing:
            // If you prefer allowing out-of-range typing and only clamping on blur/save,
            // remove this block.
            if (parsed < 0 || parsed > MAX_MULTIPLIER) return;
        }

        setLocalMultipliers(prev => ({ ...prev, [nodeId]: value }));
    };

    const handleDescriptionChange = (nodeId: number, value: string) => {
        if (value.length > MAX_DESCRIPTION_LENGTH) return;
        setLocalDescriptions(prev => ({ ...prev, [nodeId]: value }));
    };

    const handleMultiplierBlur = (nodeId: number, fallback: number) => {
        const raw = localMultipliers[nodeId] ?? '';
        const parsed = parseMultiplierOrNull(raw);

        // If empty/invalid on blur, revert to previous value (from node) rather than forcing 1.00
        if (parsed === null) {
            setLocalMultipliers(prev => ({ ...prev, [nodeId]: formatMultiplier(fallback) }));
            return;
        }

        const clamped = clamp(parsed, 0, MAX_MULTIPLIER);
        setLocalMultipliers(prev => ({ ...prev, [nodeId]: formatMultiplier(clamped) }));
    };

    const normalizeDescription = (value: string | null | undefined): string | null => {
        if (!value) return null;
        const trimmed = value.trim();
        return trimmed.length === 0 ? null : trimmed;
    };

    const validateBeforeSave = (): { ok: boolean; message?: string } => {
        const invalid: string[] = [];
        const outOfRange: string[] = [];
        const tooLong: string[] = [];

        for (const node of nodes) {
            const raw = localMultipliers[node.id] ?? '';
            const parsed = parseMultiplierOrNull(raw);
            const description = localDescriptions[node.id] ?? node.price_multiplier_description ?? '';

            if (parsed === null) {
                invalid.push(node.name);
                continue;
            }

            if (parsed < 0 || parsed > MAX_MULTIPLIER) {
                outOfRange.push(node.name);
            }

            if (description.length > MAX_DESCRIPTION_LENGTH) {
                tooLong.push(node.name);
            }
        }

        if (invalid.length) {
            return {
                ok: false,
                message: `Multiplier cannot be empty/invalid for: ${invalid.join(', ')}`,
            };
        }

        if (outOfRange.length) {
            return {
                ok: false,
                message: `Multiplier must be between 0 and ${MAX_MULTIPLIER} for: ${outOfRange.join(', ')}`,
            };
        }

        if (tooLong.length) {
            return {
                ok: false,
                message: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer for: ${tooLong.join(', ')}`,
            };
        }

        return { ok: true };
    };

    const handleSaveAll = async () => {
        clearFlashes('admin:billing:node-pricing');

        const validation = validateBeforeSave();
        if (!validation.ok) {
            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'error',
                message: validation.message || 'Please fix invalid multipliers before saving.',
            });
            return;
        }

        setSaving(true);

        try {
            const updates = nodes
                .map(node => {
                    const raw = localMultipliers[node.id] ?? formatMultiplier(node.price_multiplier);
                    const parsed = parseMultiplierOrNull(raw);
                    const rawDescription = localDescriptions[node.id] ?? node.price_multiplier_description ?? '';

                    // parsed should never be null here due to validateBeforeSave, but safe anyway
                    const clamped = parsed === null ? node.price_multiplier : clamp(parsed, 0, MAX_MULTIPLIER);
                    const description = normalizeDescription(rawDescription);
                    const originalDescription = normalizeDescription(node.price_multiplier_description ?? '');

                    return {
                        id: node.id,
                        price_multiplier: clamped,
                        price_multiplier_description: description,
                        original: node.price_multiplier,
                        originalDescription,
                    };
                })
                .filter(
                    u => u.price_multiplier !== u.original || u.price_multiplier_description !== u.originalDescription,
                )
                .map(({ id, price_multiplier, price_multiplier_description }) => ({
                    id,
                    price_multiplier,
                    price_multiplier_description,
                }));

            if (updates.length === 0) {
                addFlash({
                    key: 'admin:billing:node-pricing',
                    type: 'info',
                    message: 'No changes to save.',
                });
                return;
            }

            await batchUpdateNodePricing(updates);
            await loadNodePricing();

            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'success',
                message: `Successfully updated ${updates.length} node pricing multiplier(s).`,
            });
        } catch (error) {
            console.error('Failed to save node pricing:', error);
            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'error',
                message: 'Failed to save node pricing. Please try again.',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async (nodeId: number) => {
        clearFlashes('admin:billing:node-pricing');
        setSaving(true);

        try {
            await resetNodePricing(nodeId);
            await loadNodePricing();

            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'success',
                message: 'Successfully reset node pricing to 1.00x.',
            });
        } catch (error) {
            console.error('Failed to reset node pricing:', error);
            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'error',
                message: 'Failed to reset node pricing. Please try again.',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleResetAll = async () => {
        clearFlashes('admin:billing:node-pricing');

        if (!confirm('Are you sure you want to reset all node pricing multipliers to 1.00x?')) {
            return;
        }

        setSaving(true);

        try {
            await resetAllNodePricing();
            await loadNodePricing();

            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'success',
                message: 'Successfully reset all node pricing multipliers to 1.00x.',
            });
        } catch (error) {
            console.error('Failed to reset all node pricing:', error);
            addFlash({
                key: 'admin:billing:node-pricing',
                type: 'error',
                message: 'Failed to reset all node pricing. Please try again.',
            });
        } finally {
            setSaving(false);
        }
    };

    const hasChanges = nodes.some(node => {
        const raw = localMultipliers[node.id] ?? formatMultiplier(node.price_multiplier);

        const parsed = parseMultiplierOrNull(raw);
        if (parsed === null) return true; // counts as unsaved/invalid change

        const rawDescription = localDescriptions[node.id];
        const normalizedDescription = normalizeDescription(rawDescription ?? node.price_multiplier_description ?? '');
        const originalDescription = normalizeDescription(node.price_multiplier_description ?? '');

        return parsed !== node.price_multiplier || normalizedDescription !== originalDescription;
    });

    if (loading) {
        return (
            <AdminBox title={'Node Pricing Multipliers'} icon={faMapMarkerAlt}>
                <p className={'text-gray-400'}>Loading...</p>
            </AdminBox>
        );
    }

    if (nodes.length === 0) {
        return (
            <AdminBox title={'Node Pricing Multipliers'} icon={faMapMarkerAlt}>
                <Alert type={'info'}>No nodes found. Create nodes first to configure location-based pricing.</Alert>
            </AdminBox>
        );
    }

    return (
        <AdminBox title={'Node Pricing Multipliers'} icon={faMapMarkerAlt}>
            <p className={'mb-4 text-gray-400'}>
                Configure location-based pricing for each node. The final checkout price will be multiplied by the
                selected node&apos;s multiplier. Allowed range: <strong>0.00</strong> to{' '}
                <strong>{MAX_MULTIPLIER.toFixed(2)}</strong>.
            </p>
            <p className={'mb-2 text-xs text-neutral-400'}>Descriptions appear on the checkout location selector.</p>

            <div css={tw`overflow-x-auto mb-4`}>
                <table css={tw`w-full border-collapse`}>
                    <thead>
                        <tr css={tw`border-b-2 border-neutral-600`}>
                            <th css={tw`text-left py-3 px-4 text-neutral-300 font-semibold`}>Node</th>
                            <th css={tw`text-left py-3 px-4 text-neutral-300 font-semibold`}>Pricing Multiplier</th>
                            <th css={tw`text-left py-3 px-4 text-neutral-300 font-semibold`}>Effect on Price</th>
                            <th css={tw`text-left py-3 px-4 text-neutral-300 font-semibold w-1/3`}>
                                Description (shown to customers)
                            </th>
                            <th css={tw`text-right py-3 px-4 text-neutral-300 font-semibold`}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {nodes.map(node => {
                            const raw = localMultipliers[node.id] ?? formatMultiplier(node.price_multiplier);
                            const parsed = parseMultiplierOrNull(raw);

                            const isEmpty = raw.trim() === '';
                            const isInvalid = !isEmpty && parsed === null;
                            const isOutOfRange = parsed !== null && (parsed < 0 || parsed > MAX_MULTIPLIER);

                            const descriptionValue =
                                localDescriptions[node.id] ?? node.price_multiplier_description ?? '';
                            const multiplierForDisplay = parsed === null ? node.price_multiplier : parsed;
                            const hasDescriptionChanged =
                                normalizeDescription(descriptionValue) !==
                                normalizeDescription(node.price_multiplier_description ?? '');
                            const hasChanged =
                                parsed === null ? true : parsed !== node.price_multiplier || hasDescriptionChanged;

                            return (
                                <tr
                                    key={node.id}
                                    css={[
                                        tw`border-b border-neutral-700 hover:bg-neutral-700 transition-colors`,
                                        hasChanged && tw`bg-neutral-800`,
                                    ]}
                                >
                                    <td css={tw`py-3 px-4`}>
                                        <div css={tw`flex flex-col`}>
                                            <span css={tw`text-neutral-100 font-medium`}>{node.name}</span>
                                            <span css={tw`text-xs text-neutral-400`}>
                                                ID: {node.id}
                                                {node.deployable && <span css={tw`ml-2 text-green-400`}>• Paid</span>}
                                                {node.deployable_free && (
                                                    <span css={tw`ml-2 text-blue-400`}>• Free</span>
                                                )}
                                            </span>
                                        </div>
                                    </td>

                                    <td css={tw`py-3 px-4`}>
                                        <div css={tw`flex items-center gap-2`}>
                                            <Input
                                                type={'text'}
                                                inputMode="decimal"
                                                value={raw}
                                                onChange={e => handleMultiplierChange(node.id, e.target.value)}
                                                onBlur={() => handleMultiplierBlur(node.id, node.price_multiplier)}
                                                disabled={saving}
                                                css={[tw`w-24`, (isInvalid || isOutOfRange) && tw`border-red-500`]}
                                                placeholder="1.00"
                                            />
                                            <span css={tw`text-xs text-neutral-400`}>x</span>
                                        </div>

                                        {(isInvalid || isOutOfRange) && (
                                            <div css={tw`text-xs text-red-400 mt-1`}>
                                                {isInvalid && 'Invalid number'}
                                                {isOutOfRange && `Must be 0.00–${MAX_MULTIPLIER.toFixed(2)}`}
                                            </div>
                                        )}
                                    </td>

                                    <td css={tw`py-3 px-4`}>
                                        <span
                                            css={[
                                                tw`font-medium`,
                                                multiplierForDisplay === 1.0 && tw`text-blue-400`,
                                                multiplierForDisplay > 1.0 && tw`text-red-400`,
                                                multiplierForDisplay < 1.0 && tw`text-green-400`,
                                            ]}
                                        >
                                            {formatMultiplierDisplay(multiplierForDisplay)}
                                        </span>
                                    </td>

                                    <td css={tw`py-3 px-4`}>
                                        <Textarea
                                            rows={3}
                                            value={descriptionValue}
                                            onChange={e => handleDescriptionChange(node.id, e.target.value)}
                                            maxLength={MAX_DESCRIPTION_LENGTH}
                                            disabled={saving}
                                            placeholder="Higher power costs at this location."
                                        />
                                        <div css={tw`text-xs text-neutral-500 mt-1 flex justify-between`}>
                                            <span>This appears on the checkout location selector.</span>
                                            <span>
                                                {descriptionValue.length}/{MAX_DESCRIPTION_LENGTH}
                                            </span>
                                        </div>
                                    </td>

                                    <td css={tw`py-3 px-4 text-right`}>
                                        <Button
                                            type="button"
                                            onClick={() => handleReset(node.id)}
                                            className="!bg-neutral-600 hover:!bg-neutral-500"
                                            disabled={saving || Number(node.price_multiplier) === 1.0}
                                            size="small"
                                        >
                                            <FontAwesomeIcon icon={faUndo} className="mr-2" />
                                            Reset to 1.00x
                                        </Button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Alert type={'info'} className={'mt-4'}>
                <strong>How it works:</strong> When a customer selects a node during checkout, the final price is
                calculated as:
                <code css={tw`mx-1 px-1 bg-neutral-700 rounded`}>
                    base_price × billing_cycle_multiplier × node_multiplier
                </code>
                . For example, a $10/month product with a 1.15x node multiplier would cost $11.50/month at that
                location.
            </Alert>

            <div className={'mt-6 flex justify-between'}>
                <Button
                    type="button"
                    onClick={handleResetAll}
                    className="!bg-red-500 hover:!bg-red-600"
                    disabled={saving}
                >
                    <FontAwesomeIcon icon={faRedo} className="mr-2" />
                    Reset All to 1.00x
                </Button>

                <div css={tw`flex gap-2`}>
                    {hasChanges && (
                        <span css={tw`text-yellow-400 self-center mr-2 text-sm`}>You have unsaved changes</span>
                    )}
                    <Button onClick={handleSaveAll} disabled={saving || !hasChanges}>
                        <FontAwesomeIcon icon={faSave} className="mr-2" />
                        {saving ? 'Saving...' : 'Save All Changes'}
                    </Button>
                </div>
            </div>
        </AdminBox>
    );
};
