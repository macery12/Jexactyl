import { lazy } from 'react';
import { route, type RouteDef } from './registry';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const CheckpointPage = lazy(() => import('@/pages/auth/CheckpointPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const DiscordLinkChoicePage = lazy(() => import('@/pages/auth/DiscordLinkChoicePage'));
const DiscordRegisterPage = lazy(() => import('@/pages/auth/DiscordRegisterPage'));

// Auth area (/v2/auth/*). Seeded from V1_UI_Map §3.1.
export const authRoutes: RouteDef[] = [
    route('login', { name: 'Login', element: LoginPage, end: true }),
    route('login/checkpoint', { name: '2FA Checkpoint', element: CheckpointPage }),
    route('register', { name: 'Register', element: RegisterPage, condition: f => f.auth.registration.enabled }),
    route('password', { name: 'Forgot Password', element: ForgotPasswordPage }),
    route('password/reset/:token', { element: ResetPasswordPage }),
    route('discord/link-choice', { element: DiscordLinkChoicePage, condition: f => f.auth.modules.discord.enabled }),
    route('discord/register', { element: DiscordRegisterPage, condition: f => f.auth.modules.discord.enabled }),
];
