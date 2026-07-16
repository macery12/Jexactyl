import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faHeart, faIdBadge } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from 'easy-peasy';
import SearchContainer from '@account/search/SearchContainer';
import AlertHistoryContainer from '@account/AlertHistoryContainer';
import tw from 'twin.macro';
import styled from 'styled-components';
import { SiteTheme } from '@/state/theme';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/outline';
import { useActivityLogs } from '@/api/routes/account/activity';
import Spinner from '@/elements/Spinner';
import { formatDistanceToNow } from 'date-fns';
import MobileDrawer from '@/elements/MobileDrawer';

const RightNavigation = styled.div<{ theme: SiteTheme }>`
    & > a,
    & > button,
    & > div,
    & > .navigation-link {
        ${tw`flex items-center h-full no-underline text-neutral-300 px-6 cursor-pointer transition-all duration-300 gap-x-2`};
        ${tw`text-gray-400 font-medium`};

        &:active,
        &:hover,
        &.active {
            box-shadow: inset 0 -1px ${({ theme }) => theme.colors.primary};
        }
    }
`;

const NavigationBar = () => {
    const [width, setWidth] = useState(0);
    const [currentPage, setCurrentPage] = useState(0);

    const location = useLocation();
    const theme = useStoreState(state => state.theme.data!);
    const user = useStoreState(state => state.user.data!);
    const activityEnabled = useStoreState(state => state.settings.data!.activity.enabled.account);
    const { data } = useActivityLogs({ page: 1 }, { revalidateOnMount: true, revalidateOnFocus: false });

    const pathnames = location.pathname.split('/').filter(Boolean);

    useEffect(() => {
        const interval = setInterval(() => {
            setWidth(prev => {
                if (prev >= 80) {
                    setCurrentPage(p => (p + 1) % 3);
                    return 0;
                }
                return prev + 1;
            });
        }, 75);
        return () => clearInterval(interval);
    }, []);

    const renderBreadcrumbs = () => (
        <ol className="inline-flex min-w-0 flex-1 items-center space-x-2 overflow-hidden text-sm text-gray-400">
            <Link to={'/'}>
                <HomeIcon className="my-auto h-4 w-4 brightness-150" />
            </Link>
            {pathnames.map((segment, index) => {
                const href = `/${pathnames.slice(0, index + 1).join('/')}`;
                return (
                    <li key={index} className="inline-flex">
                        <ChevronRightIcon className="my-auto mr-2 h-4 w-4" />
                        {index === pathnames.length - 1 ? (
                            <span className="capitalize">{segment}</span>
                        ) : (
                            <Link to={href} className="capitalize brightness-150">
                                {segment}
                            </Link>
                        )}
                    </li>
                );
            })}
        </ol>
    );

    const renderPageContent = () => {
        switch (currentPage) {
            case 0:
                return (
                    <>
                        <FontAwesomeIcon icon={faEye} />
                        {!data || !activityEnabled ? (
                            <Spinner size="small" centered />
                        ) : (
                            <>
                                <span className="mb-1 font-bold">{data.items[0]?.event}</span> -{' '}
                                <span className="text-xs">
                                    {formatDistanceToNow(data.items[0]?.timestamp ?? new Date(), {
                                        includeSeconds: true,
                                        addSuffix: true,
                                    })}
                                </span>
                            </>
                        )}
                    </>
                );
            case 1:
                return (
                    <>
                        <FontAwesomeIcon icon={faHeart} className={user.useTotp ? 'text-green-400' : 'text-red-400'} />
                        2FA is {user.useTotp ? 'Enabled' : 'Disabled'}
                    </>
                );
            case 2:
                return (
                    <>
                        <FontAwesomeIcon icon={faIdBadge} />
                        User ID: {user.uuid.slice(0, 8)}
                    </>
                );
            default:
                return null;
        }
    };

    return (
        <div className="mb-8 w-full overflow-x-auto shadow-md" style={{ backgroundColor: theme.colors.sidebar }}>
            <div className="flex h-[3.5rem] w-full items-center px-4 sm:px-8">
                <MobileDrawer.Trigger />
                <div className="ml-2 md:ml-0">{renderBreadcrumbs()}</div>
                <RightNavigation className="ml-auto flex h-full items-center justify-center" theme={theme}>
                    <div className="relative">
                        <div
                            className="absolute top-0 h-px transition-all duration-[250ms] ease-in-out"
                            style={{
                                width: `${width}%`,
                                backgroundColor: theme.colors.primary,
                            }}
                        />
                        <div className="hidden items-center gap-x-1 lg:flex">{renderPageContent()}</div>
                    </div>
                    <SearchContainer />
                    <AlertHistoryContainer />
                </RightNavigation>
            </div>
        </div>
    );
};

export default NavigationBar;
