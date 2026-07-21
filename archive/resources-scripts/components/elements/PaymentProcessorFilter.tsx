import React from 'react';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';

export type PaymentProcessor = 'stripe' | 'paypal' | 'free';

interface Props {
    value: PaymentProcessor | null;
    onChange: (processor: PaymentProcessor | null) => void;
}

const PaymentProcessorFilter: React.FC<Props> = ({ value, onChange }) => {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <div css={tw`flex items-center gap-2`}>
            <label css={tw`text-sm text-gray-400 whitespace-nowrap`}>Payment Provider:</label>
            <select
                value={value || ''}
                onChange={e => onChange(e.target.value === '' ? null : (e.target.value as PaymentProcessor))}
                css={tw`border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none`}
                style={{ backgroundColor: colors.secondary }}
            >
                <option value="">All Providers</option>
                <option value="stripe">Stripe</option>
                <option value="paypal">PayPal</option>
                <option value="free">Free</option>
            </select>
        </div>
    );
};

export default PaymentProcessorFilter;
