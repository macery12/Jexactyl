import { useStoreState } from '@/state/hooks';
import { ReactElement, ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import classNames from 'classnames';

interface Props {
    image?: ReactElement;
    icon: IconDefinition;
    title: string;
    children: ReactNode;
    noHeight?: boolean;
}

export default ({ image, icon, title, children, noHeight }: Props) => {
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    return (
        <div
            className={classNames(
                !noHeight && 'min-h-[50vh] lg:h-[80vh]',
                'my-auto grid max-w-7xl gap-4 lg:grid-cols-2 lg:gap-12',
            )}
        >
            <span className={'hidden lg:flex'}>{image}</span>
            <div className={'my-auto'}>
                <p className={'mb-2 text-2xl font-bold text-white lg:text-5xl'}>
                    <FontAwesomeIcon icon={icon} style={{ color: primary }} className={'mr-4'} size={'sm'} />
                    {title}
                </p>
                <p className={'my-2 text-gray-400'}>{children}</p>
            </div>
        </div>
    );
};
