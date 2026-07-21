import { useStoreState } from 'easy-peasy';
import { NavLink, Route, Routes } from 'react-router-dom';
import Avatar from '@/elements/Avatar';
import Sidebar from '@/elements/Sidebar';
import AdminIndicators from '@admin/AdminIndicators';
import { usePersistedState } from '@/plugins/usePersistedState';
import MobileDrawer from '@/elements/MobileDrawer';
import Pill from '@/elements/Pill';
import ErrorBoundary from '@/elements/ErrorBoundary';
import routes from './routes';
import Spinner from '@/elements/Spinner';
import { NotFound } from '@/elements/ScreenBlock';
import { PuzzleIcon, ReplyIcon } from '@heroicons/react/outline';
import { Fragment } from 'react';
import ScopedAlert from '@account/ScopedAlert';
import RequireAdminPermission from '@/elements/RequireAdminPermission';

function AdminRouter() {
    const theme = useStoreState(state => state.theme.data!);
    const user = useStoreState(state => state.user.data!);
    const settings = useStoreState(state => state.settings.data!);

    const activityEnabled: boolean = settings.activity.enabled.admin;

    const categories = ['general', 'modules', 'appearance', 'management', 'services', 'developers'] as const;
    const [collapsed, setCollapsed] = usePersistedState<boolean>(`sidebar_admin_${user.uuid}`, false);

    return (
        <MobileDrawer>
            <div className={'flex h-screen'}>
                {settings.indicators && <AdminIndicators />}
                <MobileDrawer.Panel>
                    <MobileDrawer.Home />
                    {categories.map(category => {
                        const categoryRoutes = routes.admin.filter(
                            route =>
                                route.category === category &&
                                route.name &&
                                (!route.condition || route.condition({ activityEnabled })),
                        );
                        if (categoryRoutes.length === 0) return null;

                        return (
                            <Fragment key={category}>
                                <MobileDrawer.Section>
                                    {category[0]!.toUpperCase() + category.slice(1)}
                                </MobileDrawer.Section>
                                {categoryRoutes.map(route => (
                                    <MobileDrawer.Link
                                        key={route.route}
                                        icon={route.icon ?? PuzzleIcon}
                                        text={route.name}
                                        linkTo={route.path}
                                        end={route.end}
                                    />
                                ))}
                            </Fragment>
                        );
                    })}
                </MobileDrawer.Panel>
                <Sidebar className={'flex-none'} $collapsed={collapsed} theme={theme}>
                    <div
                        className={
                            'my-6 flex h-16 w-full cursor-pointer select-none flex-col items-center justify-center'
                        }
                        onClick={() => setCollapsed(!collapsed)}
                    >
                        {!collapsed ? (
                            <h1 className={'whitespace-nowrap text-2xl font-medium text-neutral-50'}>
                                {settings.name}
                            </h1>
                        ) : (
                            <img
                                src={settings.logo?.toString() || 'https://avatars.githubusercontent.com/u/91636558'}
                                className={'mt-4 w-12'}
                                alt={'Logo'}
                            />
                        )}
                    </div>
                    <Sidebar.Wrapper theme={theme} $admin>
                        <NavLink to="/" className={'mb-[18px]'}>
                            <Sidebar.Icon icon={ReplyIcon} />
                            <span>Return</span>
                        </NavLink>
                        {categories.map(category => {
                            const categoryRoutes = routes.admin.filter(
                                route => route.category === category && route.name,
                            );
                            if (categoryRoutes.length === 0) return null;

                            return (
                                <Fragment key={category}>
                                    <Sidebar.Section>{category[0]!.toUpperCase() + category.slice(1)}</Sidebar.Section>
                                    {categoryRoutes
                                        .filter(
                                            route =>
                                                route.name &&
                                                (!route.condition || route.condition({ activityEnabled })),
                                        )
                                        .map(route => (
                                            <NavLink to={route.path} key={route.path} end={route.end}>
                                                <Sidebar.Icon icon={route.icon ?? PuzzleIcon} />
                                                <span>{route.name}</span>
                                            </NavLink>
                                        ))}
                                </Fragment>
                            );
                        })}
                    </Sidebar.Wrapper>
                    <Sidebar.User className={'mt-auto py-3'}>
                        <span className="flex items-center">
                            <Avatar.User />
                        </span>
                        <div className={'ml-3 flex flex-col'}>
                            <span className={'select-none font-sans text-xs font-normal leading-tight text-gray-300'}>
                                <div className={'mb-1 flex w-full justify-between'}>
                                    <p className={'text-sm text-gray-400'}>Welcome,</p>
                                    <Pill size={'xsmall'} type={'info'}>
                                        {user.roleName === 'None' ? 'Root Admin' : user.roleName}
                                    </Pill>
                                </div>
                                {user.email}
                            </span>
                        </div>
                    </Sidebar.User>
                </Sidebar>
                <div
                    className={'flex-1 overflow-x-hidden px-4 pt-4 sm:px-6 sm:pt-6 lg:px-10 lg:pt-8 xl:px-16 xl:pt-12'}
                >
                    {/* Mobile hamburger header – only visible below md */}
                    <div className={'mb-4 flex items-center md:hidden'}>
                        <MobileDrawer.Trigger />
                        <h1 className={'ml-3 text-lg font-medium text-neutral-50'}>{settings.name}</h1>
                    </div>
                    <ScopedAlert scope="admin" position="top-center" />
                    <ScopedAlert scope="admin" position="slide-out" />
                    <ScopedAlert scope="admin" position="center" />
                    <div className={'mx-auto flex w-full flex-col'} style={{ maxWidth: '86rem' }}>
                        <ErrorBoundary>
                            <Routes>
                                {routes.admin
                                    .filter(route => !route.condition || route.condition({ activityEnabled }))
                                    .map(({ route, component: Component, permission }) => (
                                        <Route
                                            key={route}
                                            path={route}
                                            element={
                                                <Spinner.Suspense>
                                                    {permission ? (
                                                        <RequireAdminPermission permission={permission}>
                                                            <Component />
                                                        </RequireAdminPermission>
                                                    ) : (
                                                        <Component />
                                                    )}
                                                </Spinner.Suspense>
                                            }
                                        />
                                    ))}
                                <Route path={'*'} element={<NotFound />} />
                            </Routes>
                        </ErrorBoundary>
                    </div>
                </div>
            </div>
        </MobileDrawer>
    );
}

export default AdminRouter;
