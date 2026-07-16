import { useStoreState } from '@/state/hooks';
import { Dispatch, SetStateAction } from 'react';
import { CheckCircleIcon, ServerIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import { type Node } from '@definitions/account/billing';
import tw from 'twin.macro';

interface Props {
    node: Node;
    selected: number | undefined;
    setSelected: Dispatch<SetStateAction<number>>;
    basePrice?: number;
    billingDays?: number;
}

export default ({ node, selected, setSelected, basePrice, billingDays }: Props) => {
    const { colors } = useStoreState(s => s.theme.data!);
    const isSelected = selected === Number(node.id);

    // Calculate pricing if basePrice is provided
    const nodeMultiplier = node.priceMultiplier || 1.0;
    const showPricing = basePrice !== undefined && basePrice > 0;
    const finalPrice = basePrice ? basePrice * nodeMultiplier : 0;
    const priceDifference = basePrice ? finalPrice - basePrice : 0;
    const hasPriceAdjustment = nodeMultiplier !== 1.0;

    return (
        <div
            onClick={() => setSelected(Number(node.id))}
            className={classNames(
                'relative cursor-pointer rounded-lg border-2 p-4 transition-all',
                isSelected ? 'border-gray-600 hover:border-gray-500' : 'border-gray-700 hover:border-gray-600',
            )}
            style={
                isSelected
                    ? { borderColor: colors.primary, backgroundColor: `${colors.primary}15` }
                    : { backgroundColor: colors.secondary, borderColor: '#374151' }
            }
        >
            <div className={'flex items-center gap-3'}>
                <ServerIcon className={'h-8 w-8'} style={{ color: colors.primary }} />
                <div className={'flex-1'}>
                    <p className={'font-semibold text-gray-200'}>{node.name}</p>
                    {node.priceMultiplierDescription && (
                        <p className={'mt-1 text-xs text-gray-400'}>{node.priceMultiplierDescription}</p>
                    )}
                    {showPricing && (
                        <div className={'mt-1'}>
                            <p className={'text-sm font-medium text-gray-300'}>
                                ${finalPrice.toFixed(2)}
                                {billingDays && <span className={'text-xs text-gray-500'}> / {billingDays} days</span>}
                            </p>
                            {hasPriceAdjustment && (
                                <p
                                    className={'text-xs'}
                                    css={[
                                        priceDifference > 0 && tw`text-red-400`,
                                        priceDifference < 0 && tw`text-green-400`,
                                    ]}
                                >
                                    {priceDifference > 0 ? '+' : ''}${priceDifference.toFixed(2)} (
                                    {nodeMultiplier > 1 ? '+' : ''}
                                    {((nodeMultiplier - 1) * 100).toFixed(0)}%)
                                </p>
                            )}
                        </div>
                    )}
                </div>
                <CheckCircleIcon
                    className={classNames('h-6 w-6 transition-colors', isSelected ? '' : 'text-gray-600')}
                    style={isSelected ? { color: colors.primary } : {}}
                />
            </div>
        </div>
    );
};
