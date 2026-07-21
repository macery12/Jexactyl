import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCreditCard, faCheck } from '@fortawesome/free-solid-svg-icons';
import { faPaypal } from '@fortawesome/free-brands-svg-icons';
import { useStoreState } from '@/state/hooks';

export type PaymentMethod = 'stripe' | 'paypal';

interface Props {
    selected: PaymentMethod | undefined;
    onSelect: (method: PaymentMethod) => void;
    processors: Array<{ method: PaymentMethod; available: boolean }>;
}

interface ProcessorCardProps {
    method: PaymentMethod;
    available: boolean;
    selected: boolean;
    onSelect: () => void;
}

const PROCESSOR_META: Record<PaymentMethod, { label: string; subtitle: (billing: { link?: boolean }) => string }> = {
    stripe: {
        label: 'Stripe',
        subtitle: billing => `Card, PayPal${billing.link ? ', Link' : ''}`,
    },
    paypal: {
        label: 'PayPal',
        subtitle: () => 'PayPal account or card',
    },
};

function ProcessorCard({ method, available, selected, onSelect }: ProcessorCardProps) {
    const { colors } = useStoreState(state => state.theme.data!);
    const billing = useStoreState(state => state.everest.data!.billing);
    const meta = PROCESSOR_META[method];
    const icon = method === 'paypal' ? faPaypal : faCreditCard;

    return (
        <button
            type={'button'}
            disabled={!available}
            onClick={onSelect}
            className={classNames(
                'relative flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all',
                available
                    ? 'hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2'
                    : 'cursor-not-allowed opacity-50',
                selected ? 'border-primary' : 'border-gray-600 bg-transparent',
            )}
            style={
                selected
                    ? { borderColor: colors.primary, backgroundColor: `${colors.primary}15` }
                    : { backgroundColor: colors.background, borderColor: '#374151' }
            }
        >
            <div
                className={classNames(
                    'flex h-10 w-10 items-center justify-center rounded-lg',
                    selected ? 'text-white' : 'text-gray-400',
                )}
                style={selected ? { backgroundColor: colors.primary } : { backgroundColor: colors.secondary }}
            >
                <FontAwesomeIcon icon={icon} className={'h-5 w-5'} />
            </div>
            <div className={'flex-1'}>
                <div className={'flex items-center gap-2'}>
                    <p className={'font-semibold text-gray-100'}>{meta.label}</p>
                    {selected && (
                        <FontAwesomeIcon icon={faCheck} className={'h-4 w-4'} style={{ color: colors.primary }} />
                    )}
                </div>
                <p className={'mt-0.5 text-xs text-gray-400'}>{meta.subtitle(billing)}</p>
                {!available && <p className={'mt-1 text-xs text-yellow-400'}>Unavailable</p>}
            </div>
        </button>
    );
}

export default function ProcessorSelectorGrid({ selected, onSelect, processors }: Props) {
    return (
        <div className={'mb-6'}>
            <h4 className={'mb-3 text-sm font-semibold text-gray-200'}>Select Payment Method</h4>
            <div className={'grid gap-3 sm:grid-cols-2'}>
                {processors.map(p => (
                    <ProcessorCard
                        key={p.method}
                        method={p.method}
                        available={p.available}
                        selected={selected === p.method}
                        onSelect={() => onSelect(p.method)}
                    />
                ))}
            </div>
        </div>
    );
}
