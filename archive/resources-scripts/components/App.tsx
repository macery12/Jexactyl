import { lazy, Suspense } from 'react';
import '@/assets/tailwind.css';
import { store } from '@/state';
import { SiteTheme } from '@/state/theme';
import { StoreProvider } from 'easy-peasy';
import { AdminContext } from '@/state/admin';
import { ServerContext } from '@/state/server';
import { SiteSettings } from '@/state/settings';
import Spinner from '@/elements/Spinner';
import ProgressBar from '@/elements/ProgressBar';
import GlobalStylesheet from '@/assets/css/GlobalStylesheet';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AuthenticatedRoute from '@/elements/AuthenticatedRoute';
import { NotFound } from '@/elements/ScreenBlock';
import ScreenBlock from '@/elements/ScreenBlock';
import { EverestSettings } from '@/state/everest';
import ServerErrorSvg from '@/assets/images/server_error.svg';
import http from '@/api/http';

const AdminRouter = lazy(() => import('@/routers/AdminRouter'));
const AuthenticationRouter = lazy(() => import('@/routers/AuthenticationRouter'));
const DashboardRouter = lazy(() => import('@/routers/DashboardRouter'));
const ServerRouter = lazy(() => import('@/routers/ServerRouter'));
const Onboarding = lazy(() => import('@account/Onboarding'));
const SpeedDial = lazy(() => import('@/elements/SpeedDial'));
const SetupContainer = lazy(() => import('./admin/setup/SetupContainer'));

interface ExtendedWindow extends Window {
    SiteConfiguration?: SiteSettings;
    ThemeConfiguration?: SiteTheme;
    EverestConfiguration?: EverestSettings & { email?: { enabled?: boolean } };
    PterodactylUser?: {
        uuid: string;
        username: string;
        email: string;
        root_admin: boolean;
        use_totp: boolean;
        language: string;
        avatar_url: string;
        admin_role_name: string;
        admin_role_id?: number;
        state: string;
        email_verified?: boolean;
        email_verified_at?: string | null;
        updated_at: string;
        created_at: string;
        discord_linked?: boolean;
    };
}

function App() {
    const { PterodactylUser, SiteConfiguration, EverestConfiguration, ThemeConfiguration } = window as ExtendedWindow;

    if (PterodactylUser && !store.getState().user.data) {
        store.getActions().user.setUserData({
            uuid: PterodactylUser.uuid,
            username: PterodactylUser.username,
            email: PterodactylUser.email,
            language: PterodactylUser.language,
            rootAdmin: PterodactylUser.root_admin,
            avatarURL: PterodactylUser.avatar_url,
            roleName: PterodactylUser.admin_role_name,
            admin_role_id: PterodactylUser.admin_role_id,
            state: PterodactylUser.state,
            useTotp: PterodactylUser.use_totp,
            emailVerified: Boolean(PterodactylUser.email_verified),
            emailVerifiedAt: PterodactylUser.email_verified_at
                ? new Date(PterodactylUser.email_verified_at)
                : undefined,
            createdAt: new Date(PterodactylUser.created_at),
            updatedAt: new Date(PterodactylUser.updated_at),
            discordLinked: Boolean(PterodactylUser.discord_linked),
        });
    }

    if (!store.getState().settings.data) {
        store.getActions().settings.setSettings(SiteConfiguration!);
    }

    if (!store.getState().theme.data) {
        store.getActions().theme.setTheme(ThemeConfiguration!);
    }

    if (!store.getState().everest.data && EverestConfiguration) {
        store.getActions().everest.setEverest(EverestConfiguration);
    }

    if (PterodactylUser?.state === 'suspended') {
        const handleLogout = () => {
            http.post('/auth/logout').finally(() => {
                window.location.href = '/auth/login';
            });
        };

        return (
            <StoreProvider store={store}>
                <GlobalStylesheet />
                <ScreenBlock
                    title={'Account Blocked'}
                    image={ServerErrorSvg}
                    message={
                        'Your account has been blocked by an administrator. Please contact support if you believe this is an error.'
                    }
                >
                    <button
                        onClick={handleLogout}
                        className={
                            'mt-6 px-6 py-2 rounded-full border border-red-500/60 bg-red-500/10 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-colors cursor-pointer'
                        }
                    >
                        Logout
                    </button>
                </ScreenBlock>
            </StoreProvider>
        );
    }

    if (PterodactylUser?.state === 'pending') {
        const pendingMessage =
            EverestConfiguration?.auth.modules.jguard.pending_message ||
            'Your account is pending approval. An administrator will review your registration shortly.';

        return (
            <StoreProvider store={store}>
                <GlobalStylesheet />
                <ScreenBlock title={'Awaiting Approval'} image={ServerErrorSvg} message={pendingMessage} />
            </StoreProvider>
        );
    }

    const hasAdminRole: boolean = (PterodactylUser?.root_admin || Boolean(PterodactylUser?.admin_role_id)) ?? false;

    return (
        <>
            <GlobalStylesheet />
            <StoreProvider store={store}>
                <ProgressBar />
                {PterodactylUser?.root_admin && !SiteConfiguration?.setup ? (
                    <Spinner.Suspense>
                        <SetupContainer />
                    </Spinner.Suspense>
                ) : (
                    <>
                        {' '}
                        {PterodactylUser?.username.startsWith('null_user_') &&
                        EverestConfiguration?.auth.modules.onboarding.enabled ? (
                            <Spinner.Suspense>
                                <Onboarding />
                            </Spinner.Suspense>
                        ) : (
                            <div className="mx-auto w-auto">
                                <BrowserRouter>
                                    <Routes>
                                        <Route
                                            path="/auth/*"
                                            element={
                                                <Spinner.Suspense>
                                                    <AuthenticationRouter />
                                                </Spinner.Suspense>
                                            }
                                        />

                                        <Route
                                            path="/server/:id/*"
                                            element={
                                                <AuthenticatedRoute>
                                                    <Spinner.Suspense>
                                                        <ServerContext.Provider>
                                                            <Suspense fallback={null}>
                                                                {hasAdminRole && <SpeedDial />}
                                                            </Suspense>
                                                            <ServerRouter />
                                                        </ServerContext.Provider>
                                                    </Spinner.Suspense>
                                                </AuthenticatedRoute>
                                            }
                                        />

                                        <Route
                                            path="/admin/*"
                                            element={
                                                <Spinner.Suspense>
                                                    <AdminContext.Provider>
                                                        <AdminRouter />
                                                    </AdminContext.Provider>
                                                </Spinner.Suspense>
                                            }
                                        />

                                        <Route
                                            path="/*"
                                            element={
                                                <AuthenticatedRoute>
                                                    <Spinner.Suspense>
                                                        <Suspense fallback={null}>
                                                            {hasAdminRole && <SpeedDial />}
                                                        </Suspense>
                                                        <DashboardRouter />
                                                    </Spinner.Suspense>
                                                </AuthenticatedRoute>
                                            }
                                        />

                                        <Route path="*" element={<NotFound />} />
                                    </Routes>
                                </BrowserRouter>
                            </div>
                        )}
                    </>
                )}
            </StoreProvider>
        </>
    );
}

export { App };
