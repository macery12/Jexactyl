import TransferListener from '@server/TransferListener';
import { Fragment, useEffect, useRef, useState, type MouseEvent } from 'react';
import { NavLink, Route, Routes, useParams } from 'react-router-dom';
import WebsocketHandler from '@server/WebsocketHandler';
import { ServerContext, ServerStatus } from '@/state/server';
import Spinner from '@/elements/Spinner';
import { NotFound, ServerError, Suspended } from '@/elements/ScreenBlock';
import { httpErrorToHuman } from '@/api/http';
import { useStoreState } from 'easy-peasy';
import InstallListener from '@server/InstallListener';
import ErrorBoundary from '@/elements/ErrorBoundary';
import { useLocation } from 'react-router-dom';
import ConflictStateRenderer from '@server/ConflictStateRenderer';
import MobileDrawer from '@/elements/MobileDrawer';
import PermissionRoute from '@/elements/PermissionRoute';
import routes from '@/routers/routes';
import Sidebar from '@/elements/Sidebar';
import { usePersistedState } from '@/plugins/usePersistedState';
import { CogIcon, DesktopComputerIcon, PuzzleIcon, ReplyIcon } from '@heroicons/react/outline';
import SidebarControls from '@server/console/SidebarControls';
import classNames from 'classnames';
import NavigationBar from '@/elements/NavigationBar';
import ScopedAlert from '@account/ScopedAlert';
import BypassModeHeader from '@/elements/BypassModeHeader';
import FloatingWindowsLayer, { type FloatingServerWindow } from '@server/floating/FloatingWindowsLayer';

type ServerRouteFlags = {
    billable: boolean;
    activityEnabled: boolean;
    modsEnabled: boolean;
    extensionsEnabled: boolean;
    supercharged: boolean;
    aiEnabled: boolean;
    aiAssistantEnabled: boolean;
    customDomainsEnabled: boolean;
};

function statusToColor(status: ServerStatus): string {
    switch (status) {
        case 'running':
            return 'border-green-500';
        case 'offline':
            return 'border-red-500';
        case 'starting':
            return 'border-yellow-500';
        case 'stopping':
            return 'border-yellow-500';
        default:
            return 'border-gray-500';
    }
}

// Helper component to render server routes
const ServerRoutes = ({ location, flags }: { location: ReturnType<typeof useLocation>; flags: ServerRouteFlags }) => (
    <ErrorBoundary>
        <Routes location={location}>
            {routes.server
                .filter(route => !route.condition || route.condition(flags))
                .map(({ route, permission, component: Component }) => (
                    <Route
                        key={route}
                        path={route}
                        element={
                            <PermissionRoute permission={permission}>
                                <Spinner.Suspense>
                                    <Component />
                                </Spinner.Suspense>
                            </PermissionRoute>
                        }
                    />
                ))}

            <Route path="*" element={<NotFound />} />
        </Routes>
    </ErrorBoundary>
);

function ServerRouter() {
    const params = useParams<'id'>();
    const location = useLocation();

    const rootAdmin = useStoreState(state => state.user.data!.rootAdmin);
    const [error, setError] = useState('');

    const user = useStoreState(state => state.user.data!);
    const theme = useStoreState(state => state.theme.data!);
    const name = useStoreState(state => state.settings.data!.name);
    const logo = useStoreState(state => state.settings.data!.logo);
    const inConflictState = ServerContext.useStoreState(state => state.server.inConflictState);
    const getServer = ServerContext.useStoreActions(actions => actions.server.getServer);
    const clearServerState = ServerContext.useStoreActions(actions => actions.clearServerState);
    const [collapsed, setCollapsed] = usePersistedState<boolean>(`sidebar_user_${user.uuid}`, false);
    const server = ServerContext.useStoreState(state => state.server.data);
    const activityEnabled = useStoreState(state => state.settings.data!.activity.enabled.server);
    const aiEnabled = useStoreState(state => state.everest.data!.ai.enabled);
    const aiAssistantEnabled = useStoreState(state => state.everest.data!.ai.feature_server_assistant ?? true);
    const customDomainsEnabled = useStoreState(state => state.everest.data?.custom_domains?.enabled ?? false);
    const billable = server?.billingProductId;
    const modsEnabled = server?.modsEnabled;
    const extensionsEnabled = server?.extensionsEnabled;
    const supercharged = server?.isNodeSupercharged;
    const status = ServerContext.useStoreState(state => state.status.value);

    const routeFlags: ServerRouteFlags = {
        billable: Boolean(billable),
        activityEnabled,
        modsEnabled: Boolean(modsEnabled),
        extensionsEnabled: Boolean(extensionsEnabled),
        supercharged: Boolean(supercharged),
        aiEnabled,
        aiAssistantEnabled,
        customDomainsEnabled,
    };

    const categories = ['data', 'configuration'] as const;
    const topWindowZRef = useRef(200);
    const [floatingWindows, setFloatingWindows] = useState<FloatingServerWindow[]>([]);

    const getNextWindowZ = () => {
        topWindowZRef.current += 1;
        return topWindowZRef.current;
    };

    const openFloatingWindow = (route: (typeof routes.server)[number]) => {
        if (!route.name || !params.id) {
            return;
        }

        const path = route.path;
        const zIndex = getNextWindowZ();

        setFloatingWindows(prev => {
            const nextOffset = prev.length % 8;

            return [
                ...prev,
                {
                    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    serverId: params.id ?? '',
                    serverUuid: server?.uuid ?? '',
                    serverName: server?.name ?? `Server ${params.id}`,
                    routePath: path,
                    title: route.name || 'Window',
                    x: 180 + nextOffset * 24,
                    y: 120 + nextOffset * 18,
                    width: path.startsWith('files') ? 980 : 920,
                    height: path.startsWith('files') ? 700 : 620,
                    zIndex,
                },
            ];
        });
    };

    const handleRouteContextMenu = (event: MouseEvent, route: (typeof routes.server)[number]) => {
        event.preventDefault();
        openFloatingWindow(route);
    };

    const closeFloatingWindow = (id: string) => {
        setFloatingWindows(prev => prev.filter(win => win.id !== id));
    };

    const focusFloatingWindow = (id: string) => {
        const nextZ = getNextWindowZ();
        setFloatingWindows(prev => prev.map(win => (win.id === id ? { ...win, zIndex: nextZ } : win)));
    };

    const moveFloatingWindow = (id: string, x: number, y: number) => {
        setFloatingWindows(prev => prev.map(win => (win.id === id ? { ...win, x, y } : win)));
    };

    const resizeFloatingWindow = (id: string, width: number, height: number) => {
        setFloatingWindows(prev => prev.map(win => (win.id === id ? { ...win, width, height } : win)));
    };

    const navigateFloatingWindow = (id: string, routePath: string) => {
        setFloatingWindows(prev => prev.map(win => (win.id === id ? { ...win, routePath } : win)));
    };

    // Check if admin has bypassed the conflict screen
    const isConflictBypassed =
        rootAdmin && server?.uuid && sessionStorage.getItem(`admin_bypass_conflict_${server.uuid}`) === 'true';

    useEffect(() => {
        clearServerState();
    }, []);

    useEffect(() => {
        setError('');

        if (params.id === undefined) {
            return;
        }

        getServer(params.id).catch(error => {
            console.error(error);
            setError(httpErrorToHuman(error));
        });

        return () => {
            clearServerState();
        };
    }, [params.id]);

    if (billable && server.renewalDate && server.renewalDate.getTime() < new Date().getTime()) {
        // Check if admin has bypassed the suspension screen
        const bypassKey = `admin_bypass_suspended_${server.uuid}`;
        const isBypassed = rootAdmin && sessionStorage.getItem(bypassKey) === 'true';

        if (!isBypassed) {
            return (
                <Suspended
                    id={server.billingProductId}
                    date={server.renewalDate}
                    serverId={Number(server.internalId)}
                    serverUuid={server.uuid}
                    serverStatus={server.status}
                />
            );
        }
    }

    // Check if we're in suspended bypass mode
    const isSuspendedBypassed =
        rootAdmin && server?.uuid && sessionStorage.getItem(`admin_bypass_suspended_${server.uuid}`) === 'true';

    return (
        <Fragment key={'server-router'}>
            {/* Global server alerts - slide-out and center popups only */}
            <ScopedAlert scope="server" position="slide-out" />
            <ScopedAlert scope="server" position="center" />
            <MobileDrawer>
                <div className={'flex h-screen'}>
                    <MobileDrawer.Panel>
                        <MobileDrawer.Home />
                        <MobileDrawer.Section>Server {server?.uuid?.slice(0, 8)}</MobileDrawer.Section>
                        {routes.server
                            .filter(
                                route =>
                                    !route.category && route.name && (!route.condition || route.condition(routeFlags)),
                            )
                            .map(route => (
                                <MobileDrawer.Link
                                    key={route.route}
                                    icon={route.icon ?? PuzzleIcon}
                                    text={route.name}
                                    linkTo={route.path}
                                    end={route.end}
                                />
                            ))}
                        {categories.map(category => {
                            const categoryRoutes = routes.server.filter(
                                route =>
                                    route.category === category &&
                                    route.name &&
                                    (!route.condition || route.condition(routeFlags)),
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
                        {(user.rootAdmin || user.admin_role_id) && (
                            <MobileDrawer.Link icon={CogIcon} text={'Admin'} linkTo={'/admin'} />
                        )}
                    </MobileDrawer.Panel>
                    <Sidebar className={'flex-none'} $collapsed={collapsed} theme={theme}>
                        <div
                            className={
                                'mt-1 mb-3 flex h-16 w-full cursor-pointer select-none flex-col items-center justify-center'
                            }
                            onClick={() => setCollapsed(!collapsed)}
                        >
                            {!collapsed ? (
                                <h1 className={'whitespace-nowrap text-2xl font-medium text-neutral-50'}>{name}</h1>
                            ) : (
                                <img
                                    src={logo?.toString() || 'https://avatars.githubusercontent.com/u/91636558'}
                                    className={'mt-4 w-12'}
                                    alt={'Logo'}
                                />
                            )}
                        </div>
                        <Sidebar.Wrapper theme={theme} className={'mb-auto'}>
                            <NavLink to={'/'} end className={'mb-[18px]'}>
                                <DesktopComputerIcon />
                                <span>Dashboard</span>
                            </NavLink>
                            <Sidebar.Section>Server {server?.uuid?.slice(0, 8)}</Sidebar.Section>
                            {routes.server
                                .filter(
                                    route =>
                                        !route.category &&
                                        route.name &&
                                        (!route.condition || route.condition(routeFlags)),
                                )
                                .map(route => (
                                    <NavLink
                                        to={route.path}
                                        key={route.path}
                                        end={route.end}
                                        onContextMenu={event => handleRouteContextMenu(event, route)}
                                    >
                                        <Sidebar.Icon icon={route.icon ?? PuzzleIcon} />
                                        <span>{route.name}</span>
                                    </NavLink>
                                ))}
                            {categories.map(category => {
                                const categoryRoutes = routes.server.filter(
                                    route =>
                                        route.category === category &&
                                        route.name &&
                                        (!route.condition || route.condition(routeFlags)),
                                );
                                if (categoryRoutes.length === 0) return null;

                                return (
                                    <Fragment key={category}>
                                        <Sidebar.Section>
                                            {category[0]!.toUpperCase() + category.slice(1)}
                                        </Sidebar.Section>
                                        {categoryRoutes.map(route => (
                                            <NavLink
                                                to={route.path}
                                                key={route.path}
                                                end={route.end}
                                                onContextMenu={event => handleRouteContextMenu(event, route)}
                                            >
                                                <Sidebar.Icon icon={route.icon ?? PuzzleIcon} />
                                                <span>{route.name}</span>
                                            </NavLink>
                                        ))}
                                    </Fragment>
                                );
                            })}
                            {user.rootAdmin && (
                                <NavLink to={`/admin/servers/${server?.internalId}`}>
                                    <ReplyIcon />
                                    <span>View as Admin</span>
                                </NavLink>
                            )}
                        </Sidebar.Wrapper>
                        <Sidebar.User className={classNames('border-t', statusToColor(status))}>
                            {server && <SidebarControls />}
                        </Sidebar.User>
                    </Sidebar>
                    {!server?.uuid || !server?.id ? (
                        error ? (
                            <ServerError message={error} />
                        ) : (
                            <Spinner size="large" centered />
                        )
                    ) : (
                        <div className={'flex-1 overflow-x-hidden'}>
                            <InstallListener />
                            <TransferListener />
                            <WebsocketHandler />
                            {(isSuspendedBypassed || isConflictBypassed) && server?.uuid && (
                                <BypassModeHeader
                                    serverUuid={server.uuid}
                                    bypassType={isSuspendedBypassed ? 'suspended' : 'conflict'}
                                />
                            )}
                            <NavigationBar />
                            <FloatingWindowsLayer
                                windows={floatingWindows}
                                currentServerId={params.id || ''}
                                onClose={closeFloatingWindow}
                                onFocus={focusFloatingWindow}
                                onMove={moveFloatingWindow}
                                onResize={resizeFloatingWindow}
                                onNavigate={navigateFloatingWindow}
                                serverRoutes={routes.server}
                            />
                            {inConflictState &&
                            (!rootAdmin || (rootAdmin && !location.pathname.endsWith(`/server/${server?.id}`))) &&
                            !isConflictBypassed ? (
                                <ConflictStateRenderer />
                            ) : (
                                <ServerRoutes location={location} flags={routeFlags} />
                            )}
                        </div>
                    )}
                </div>
            </MobileDrawer>
        </Fragment>
    );
}

export default ServerRouter;
