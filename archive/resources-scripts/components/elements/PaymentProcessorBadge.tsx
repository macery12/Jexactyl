import React from 'react';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';

interface Props {
    processor: 'stripe' | 'paypal' | 'free';
    size?: 'small' | 'medium' | 'large';
}

const PaymentProcessorBadge: React.FC<Props> = ({ processor, size = 'medium' }) => {
    const { colors } = useStoreState(state => state.theme.data!);

    const getProcessorInfo = () => {
        switch (processor) {
            case 'stripe':
                return {
                    name: 'Stripe',
                    emoji: '💳',
                };
            case 'paypal':
                return {
                    name: 'PayPal',
                    emoji: '🅿️',
                };
            case 'free':
                return {
                    name: 'Free',
                    emoji: '$0',
                };
            default:
                return {
                    name: 'Unknown',
                    emoji: '❓',
                };
        }
    };

    const getSizeClasses = () => {
        switch (size) {
            case 'small':
                return 'px-2 py-0.5 text-xs';
            case 'large':
                return 'px-4 py-2 text-base';
            case 'medium':
            default:
                return 'px-3 py-1 text-sm';
        }
    };

    const info = getProcessorInfo();

    return (
        <span
            css={tw`inline-flex items-center gap-1.5 rounded-full border font-medium shadow-sm`}
            className={getSizeClasses()}
            style={{
                backgroundColor: colors.secondary,
                borderColor: colors.primary,
                color: '#fff',
            }}
        >
            <span>{info.emoji}</span>
            {info.name}
        </span>
    );
};

export default PaymentProcessorBadge;
