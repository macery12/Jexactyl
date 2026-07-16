import { Suspense, useEffect, useState, type MouseEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { NotFound } from '@/elements/ScreenBlock';
import Spinner from '@/elements/Spinner';
import routes from '@/routers/routes';
import { useStoreState } from '@/state/hooks';
import { usePersistedState } from '@/plugins/usePersistedState';
import Sidebar from '@/elements/Sidebar';
import { CogIcon, DesktopComputerIcon, ExternalLinkIcon, LogoutIcon, PuzzleIcon } from '@heroicons/react/outline';
import Avatar from '@/elements/Avatar';
import MobileDrawer from '@/elements/MobileDrawer';
import { CustomLink } from '@/api/routes/admin/links';
import { getLinks } from '@/api/getLinks';
import http from '@/api/http';
import NavigationBar from '@/elements/NavigationBar';
import DashboardContainer from '@account/DashboardContainer';
import EmailVerificationGate from '@account/EmailVerificationGate';
import useFlash from '@/plugins/useFlash';
import { useEmailVerification } from '@/hooks/useEmailVerification';
import { Dialog } from '@/elements/dialog';
import {
    EMAIL_VERIFICATION_ALERT_MESSAGE,
    EMAIL_VERIFICATION_ALERT_TITLE,
    EMAIL_VERIFICATION_AREA_LABELS,
    getAreaForPath,
    normalizeVerificationRules,
} from '@/constants/emailVerification';

function DashboardRouter() {
    const user = useStoreState(s => s.user.data!);
    const { name, logo } = useStoreState(s => s.settings.data!);
    const theme = useStoreState(state => state.theme.data!);
    const [links, setLinks] = useState<CustomLink[] | null>();
    const flags = useStoreState(state => state.everest.data!);
    const [collapsed, setCollapsed] = usePersistedState<boolean>(`sidebar_user_${user.uuid}`, false);
    const { addFlash, clearFlashes } = useFlash();
    const emailEnabled = useStoreState(state => {
        const email = state.everest.data?.email;
        const resend = email?.resend;
        return Boolean(email?.enabled ?? (typeof resend !== 'boolean' ? resend?.enabled : undefined) ?? resend);
    });
    const verificationRules = normalizeVerificationRules(
        useStoreState(state => state.everest.data?.email?.verification_rules),
    );
    const verification = useEmailVerification(emailEnabled) || {};
    const {
        resend = () => {},
        isCoolingDown = false,
        resendLabel = 'Resend verification email',
        refreshUser: _refreshUser = () => {},
    } = verification as ReturnType<typeof useEmailVerification>;
    const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);

    useEffect(() => {
        getLinks().then(setLinks).catch();
    }, []);

    const onTriggerLogout = () => {
        http.post('/auth/logout').finally(() => {
            // @ts-expect-error this is valid
            window.location = '/';
        });
    };

    const isRestrictedRoute = (path: string) => {
        const area = getAreaForPath(path);

        if (!area) {
            return false;
        }

        const rule = verificationRules[area];

        return emailEnabled && !user.emailVerified && rule && !rule.can_view;
    };

    const handleRestrictedClick = (path: string, e: MouseEvent<HTMLAnchorElement>) => {
        const area = getAreaForPath(path);
        if (!area || user.emailVerified || !emailEnabled) {
            return;
        }

        if (isRestrictedRoute(path)) {
            e.preventDefault();
            clearFlashes('account:verification');
            addFlash({
                key: 'account:verification',
                type: 'warning',
                title: EMAIL_VERIFICATION_ALERT_TITLE,
                message: `${EMAIL_VERIFICATION_ALERT_MESSAGE} (${EMAIL_VERIFICATION_AREA_LABELS[area]})`,
            });
            setShowVerifyPrompt(true);
        }
    };

    const prefixAccountPath = (route: string) => {
        if (route.startsWith('/')) return route;
        return `/account/${route}`.replace(/\/$/, '');
    };

    return (
        <MobileDrawer>
            <div className={'flex h-screen'}>
                {' '}
                <MobileDrawer.Panel>
                    <MobileDrawer.Home />
                    {routes.account
                        .filter(route => route.name && (!route.condition || route.condition(flags)))
                        .map(route => (
                            <MobileDrawer.Link
                                key={route.route}
                                icon={route.icon ?? PuzzleIcon}
                                text={route.name}
                                linkTo={route.path !== '' ? `/account/${route.path}` : ''}
                                end={route.end}
                                onClick={e => handleRestrictedClick(route.path, e)}
                            />
                        ))}
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
                    <Sidebar.Wrapper theme={theme}>
                        <NavLink to={'/'} end className={'mb-[18px]'}>
                            <DesktopComputerIcon />
                            <span>Dashboard</span>
                        </NavLink>
                        {routes.account
                            .filter(route => route.name && (!route.condition || route.condition(flags)))
                            .map(route => (
                                <NavLink
                                    to={`/account/${route.path}`}
                                    key={route.path}
                                    end={route.end}
                                    onClick={e => handleRestrictedClick(route.path, e)}
                                >
                                    <Sidebar.Icon icon={route.icon ?? PuzzleIcon} />
                                    <span>{route.name}</span>
                                </NavLink>
                            ))}
                    </Sidebar.Wrapper>
                    <span className={'mt-auto mb-3 mr-auto'}>
                        {!collapsed && (
                            <>
                                {links?.map(link => (
                                    <a key={link.id} href={link.url} target={'_blank'} rel={'noreferrer'}>
                                        <ExternalLinkIcon />
                                        <span>{link.name}</span>
                                    </a>
                                ))}
                            </>
                        )}
                        {(user.rootAdmin || user.admin_role_id) && (
                            <NavLink to={'/admin'}>
                                <CogIcon />
                                <span className={collapsed ? 'hidden' : ''}>Settings</span>
                            </NavLink>
                        )}
                        <NavLink to={'/'} onClick={onTriggerLogout}>
                            <LogoutIcon />
                            <span className={collapsed ? 'hidden' : ''}>Logout</span>
                        </NavLink>
                    </span>
                    <Sidebar.User>
                        <span className="flex items-center">
                            <Avatar.User />
                        </span>
                        <div className={'ml-3 flex flex-col'}>
                            <span
                                className={
                                    'select-none whitespace-nowrap font-sans text-xs font-normal leading-tight text-gray-300'
                                }
                            >
                                <div className={'text-sm text-gray-400'}>Welcome back,</div>
                                {user.email}
                            </span>
                        </div>
                    </Sidebar.User>
                </Sidebar>
                <div className={'flex-1 overflow-x-hidden'}>
                    <NavigationBar />
                    <Suspense fallback={<Spinner centered />}>
                        <Routes>
                            <Route path="" element={<DashboardContainer />} />
                            {routes.account
                                .filter(route => !route.condition || route.condition(flags))
                                .map(({ route, component: Component, path }) => (
                                    <Route
                                        key={route}
                                        path={prefixAccountPath(route)}
                                        element={(() => {
                                            const area = getAreaForPath(path);
                                            const blocked = area ? isRestrictedRoute(path) : false;

                                            if (blocked && area) {
                                                return (
                                                    <EmailVerificationGate area={area}>
                                                        <Component />
                                                    </EmailVerificationGate>
                                                );
                                            }

                                            return <Component />;
                                        })()}
                                    />
                                ))}
                            <Route path="*" element={<NotFound />} />
                        </Routes>
                    </Suspense>
                    <Dialog.Confirm
                        open={showVerifyPrompt}
                        title={EMAIL_VERIFICATION_ALERT_TITLE}
                        onClose={() => setShowVerifyPrompt(false)}
                        onConfirmed={() => setShowVerifyPrompt(false)}
                        buttonType="success"
                    >
                        <p className={'mb-4'}>{EMAIL_VERIFICATION_ALERT_MESSAGE}</p>
                        <div className={'flex flex-wrap gap-2'}>
                            <button
                                className={
                                    'rounded bg-green-600 px-3 py-2 text-white disabled:opacity-50 hover:bg-green-500 transition-colors'
                                }
                                disabled={isCoolingDown}
                                onClick={() => {
                                    void resend();
                                    setShowVerifyPrompt(false);
                                }}
                            >
                                {resendLabel}
                            </button>
                            <button
                                className={'rounded bg-gray-700 px-3 py-2 text-white'}
                                onClick={() => {
                                    window.location.reload();
                                }}
                            >
                                I already verified
                            </button>
                        </div>
                    </Dialog.Confirm>
                </div>
            </div>
        </MobileDrawer>
    );
}

export default DashboardRouter;
