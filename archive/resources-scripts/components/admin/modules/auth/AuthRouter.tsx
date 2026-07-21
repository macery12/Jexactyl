import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import AdminContentBlock from '@/elements/AdminContentBlock';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import ContentBox from '@/elements/ContentBox';
import { useStoreState } from '@/state/hooks';

const AuthModulesPage = lazy(() => import('@/components/admin/modules/auth/AuthContainer'));
const JGuardSettings = lazy(() => import('@/components/admin/modules/auth/jguard/JGuardSettings'));
const JGuardPending = lazy(() => import('@/components/admin/modules/auth/jguard/JGuardPending'));

export default () => {
    const jguardEnabled = useStoreState(state => state.everest.data!.auth.modules.jguard.enabled);

    return (
        <AdminContentBlock title={'Authentication'}>
            <SubNavigation>
                <SubNavigationLink to="/admin/auth" name="Modules" base />
                {jguardEnabled && (
                    <>
                        <SubNavigationLink to="/admin/auth/jguard" name="jGuard Settings" base />
                        <SubNavigationLink to="/admin/auth/jguard/pending" name="Pending Accounts" />
                    </>
                )}
            </SubNavigation>

            <Routes>
                <Route
                    path="/"
                    element={
                        <Suspense fallback={null}>
                            <AuthModulesPage />
                        </Suspense>
                    }
                />
                {jguardEnabled && (
                    <>
                        <Route
                            path="/jguard"
                            element={
                                <ContentBox title={'jGuard Settings'} showFlashes={'auth:jguard:settings'}>
                                    <Suspense fallback={null}>
                                        <JGuardSettings />
                                    </Suspense>
                                </ContentBox>
                            }
                        />
                        <Route
                            path="/jguard/pending"
                            element={
                                <ContentBox title={'Pending Accounts'} showFlashes={'auth:jguard:pending'}>
                                    <Suspense fallback={null}>
                                        <JGuardPending />
                                    </Suspense>
                                </ContentBox>
                            }
                        />
                    </>
                )}
            </Routes>
        </AdminContentBlock>
    );
};
