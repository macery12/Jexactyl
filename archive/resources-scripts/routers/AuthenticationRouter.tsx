import { lazy } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import LoginContainer from '@/components/auth/LoginContainer';
import LoginCheckpointContainer from '@/components/auth/LoginCheckpointContainer';
import { NotFound } from '@/elements/ScreenBlock';
import tw, { styled } from 'twin.macro';
import { useStoreState } from '@/state/hooks';
import Spinner from '@/elements/Spinner';

const ForgotPasswordContainer = lazy(() => import('@/components/auth/ForgotPasswordContainer'));
const ResetPasswordWithTokenContainer = lazy(() => import('@/components/auth/ResetPasswordWithTokenContainer'));
const DiscordRegistrationContainer = lazy(() => import('@/components/auth/DiscordRegistrationContainer'));
const DiscordLinkChoiceContainer = lazy(() => import('@/components/auth/DiscordLinkChoiceContainer'));
const RegisterContainer = lazy(() => import('@/components/auth/RegisterContainer'));

const Container = styled.div`
    ${tw`min-h-screen bg-login bg-cover`};
    background-repeat: no-repeat;
    background-blend-mode: darken;
`;

export default () => {
    const navigate = useNavigate();
    const registration = useStoreState(state => state.everest.data!.auth.registration.enabled);
    const isAuthenticated = useStoreState(state => !!state.user.data?.uuid);

    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    return (
        <Container>
            <div className="pt-8 xl:pt-32">
                <Routes>
                    <Route path="login" element={<LoginContainer />} />
                    <Route path="login/checkpoint/*" element={<LoginCheckpointContainer />} />
                    {registration && (
                        <Route
                            path={'register'}
                            element={
                                <Spinner.Suspense>
                                    <RegisterContainer />
                                </Spinner.Suspense>
                            }
                        />
                    )}
                    <Route
                        path="discord/link-choice"
                        element={
                            <Spinner.Suspense>
                                <DiscordLinkChoiceContainer />
                            </Spinner.Suspense>
                        }
                    />
                    <Route
                        path="discord/register"
                        element={
                            <Spinner.Suspense>
                                <DiscordRegistrationContainer />
                            </Spinner.Suspense>
                        }
                    />
                    <Route
                        path="password"
                        element={
                            <Spinner.Suspense>
                                <ForgotPasswordContainer />
                            </Spinner.Suspense>
                        }
                    />
                    <Route
                        path="password/reset/:token"
                        element={
                            <Spinner.Suspense>
                                <ResetPasswordWithTokenContainer />
                            </Spinner.Suspense>
                        }
                    />
                    <Route path="*" element={<NotFound onBack={() => navigate('/auth/login')} />} />
                </Routes>
            </div>
        </Container>
    );
};
