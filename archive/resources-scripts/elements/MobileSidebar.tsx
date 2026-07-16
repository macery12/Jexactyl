import { ElementType, ReactNode, useState, type MouseEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useStoreState } from '@/state/hooks';
import { faHome } from '@fortawesome/free-solid-svg-icons';
import { withSubComponents } from '@/lib/helpers';

const MobileSidebar = ({ children }: { children: ReactNode[] }) => {
    return (
        <div className={'fixed bottom-0 z-50 block h-16 w-full rounded-t-xl bg-black/80 md:hidden'}>
            <div className={'flex h-full space-x-4 overflow-x-auto px-4 sm:space-x-8 sm:px-8'}>{children}</div>
        </div>
    );
};

const Link = ({
    icon: Icon,
    text,
    linkTo,
    end,
    onClick,
}: {
    icon: ElementType;
    text?: string;
    linkTo: string;
    end?: boolean;
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) => {
    const [active, setActive] = useState<boolean>(false);
    const { colors } = useStoreState(s => s.theme.data!);

    return (
        <NavLink
            to={linkTo}
            end={end}
            className={({ isActive }) =>
                `flex h-full items-center justify-center font-semibold transition duration-300 ${
                    isActive ? setActive(true) : setActive(false)
                }`
            }
            style={{ color: active ? colors.primary : '' }}
            onClick={onClick}
        >
            {Icon && <Icon className={'mr-2 h-4 w-4'} />}
            {text}
        </NavLink>
    );
};

const Home = () => {
    const { colors } = useStoreState(s => s.theme.data!);
    return (
        <>
            <NavLink to={'/'}>
                <div className={'my-auto flex h-full items-center justify-center font-semibold'}>
                    <FontAwesomeIcon icon={faHome} style={{ color: colors.primary }} className={'brightness-150'} />
                </div>
            </NavLink>
            <div className={'mx-3 my-auto'}>&bull;</div>
        </>
    );
};

export default withSubComponents(MobileSidebar, { Link, Home });
