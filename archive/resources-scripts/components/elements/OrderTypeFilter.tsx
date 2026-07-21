import React from 'react';
import tw from 'twin.macro';
import { OrderType } from '@/api/routes/account/billing/orders/types';
import { useStoreState } from '@/state/hooks';

interface Props {
    value: OrderType | null;
    onChange: (type: OrderType | null) => void;
}

const OrderTypeFilter: React.FC<Props> = ({ value, onChange }) => {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <div css={tw`flex items-center gap-2`}>
            <label css={tw`text-sm text-gray-400 whitespace-nowrap`}>Order Type:</label>
            <select
                value={value || ''}
                onChange={e => onChange(e.target.value === '' ? null : (e.target.value as OrderType))}
                css={tw`border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none`}
                style={{ backgroundColor: colors.secondary }}
            >
                <option value="">All Types</option>
                <option value="new">New Purchase</option>
                <option value="ren">Renewal</option>
                <option value="upg">Upgrade</option>
            </select>
        </div>
    );
};

export default OrderTypeFilter;
