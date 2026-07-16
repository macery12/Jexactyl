import { useStoreState } from '@/state/hooks';
import { Dispatch, SetStateAction } from 'react';
import { CheckCircleIcon, CubeIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import { type EggInfo } from '@/api/routes/account/billing/products';

interface Props {
    egg: EggInfo;
    selected: number | undefined;
    setSelected: Dispatch<SetStateAction<number | undefined>>;
    onEggChange?: () => void;
}

export default ({ egg, selected, setSelected, onEggChange }: Props) => {
    const { colors } = useStoreState(s => s.theme.data!);
    const isSelected = selected === egg.id;

    const handleClick = () => {
        if (selected !== egg.id && onEggChange) {
            onEggChange();
        }
        setSelected(egg.id);
    };

    return (
        <div
            onClick={handleClick}
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
            <div className={'flex items-start gap-3'}>
                <CubeIcon className={'h-8 w-8 flex-shrink-0'} style={{ color: colors.primary }} />
                <div className={'min-w-0 flex-1'}>
                    <p className={'font-semibold text-gray-200'}>{egg.name}</p>
                    {egg.description && (
                        <p
                            className={'mt-1 overflow-hidden text-xs text-gray-400'}
                            style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                            }}
                        >
                            {egg.description}
                        </p>
                    )}
                </div>
                <CheckCircleIcon
                    className={classNames('h-6 w-6 flex-shrink-0 transition-colors', isSelected ? '' : 'text-gray-600')}
                    style={isSelected ? { color: colors.primary } : {}}
                />
            </div>
        </div>
    );
};
