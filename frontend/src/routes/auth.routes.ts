import { lazy } from 'react';
import { route, type RouteDef } from './registry';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const CheckpointPage = lazy(() => import('@/pages/auth/CheckpointPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const SsoLinkChoicePage = lazy(() => import('@/pages/auth/SsoLinkChoicePage'));
const SsoRegisterPage = lazy(() => import('@/pages/auth/SsoRegisterPage'));

// Auth area (/auth/*). Seeded from V1_UI_Map §3.1.
export const authRoutes: RouteDef[] = [
    route('login', { name: 'Login', element: LoginPage, end: true }),
    route('login/checkpoint', { name: '2FA Checkpoint', element: CheckpointPage }),
    route('register', { name: 'Register', element: RegisterPage, condition: f => f.auth.registration.enabled }),
    route('password', { name: 'Forgot Password', element: ForgotPasswordPage }),
    route('password/reset/:token', { element: ResetPasswordPage }),
    // Provider-agnostic SSO signup/link pages — reached after a Discord or Google
    // callback finds no account for the identity. Gated on either module being on
    // rather than on Discord specifically.
    route('sso/link-choice', {
        element: SsoLinkChoicePage,
        condition: f => f.auth.modules.discord.enabled || f.auth.modules.google.enabled,
    }),
    route('sso/register', {
        element: SsoRegisterPage,
        condition: f => f.auth.modules.discord.enabled || f.auth.modules.google.enabled,
    }),
];
