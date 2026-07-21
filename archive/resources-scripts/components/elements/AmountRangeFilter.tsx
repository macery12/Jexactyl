import React from 'react';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';

interface Props {
    minValue: number | null;
    maxValue: number | null;
    onMinChange: (value: number | null) => void;
    onMaxChange: (value: number | null) => void;
}

const AmountRangeFilter: React.FC<Props> = ({ minValue, maxValue, onMinChange, onMaxChange }) => {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <div css={tw`flex items-center gap-2`}>
            <label css={tw`text-sm text-gray-400 whitespace-nowrap`}>Amount:</label>
            <input
                type="number"
                placeholder="Min"
                value={minValue || ''}
                onChange={e => onMinChange(e.target.value ? parseFloat(e.target.value) : null)}
                css={tw`border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none w-24`}
                style={{ backgroundColor: colors.secondary }}
            />
            <span css={tw`text-gray-400`}>-</span>
            <input
                type="number"
                placeholder="Max"
                value={maxValue || ''}
                onChange={e => onMaxChange(e.target.value ? parseFloat(e.target.value) : null)}
                css={tw`border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none w-24`}
                style={{ backgroundColor: colors.secondary }}
            />
        </div>
    );
};

export default AmountRangeFilter;
