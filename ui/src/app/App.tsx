import { createElement, useSyncExternalStore, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { subscribeLocale, getCurrentLocale } from '@/i18n';
import { useSession } from '@/state/session';
import type { RouteDef } from '@/routes/registry';
import { authRoutes } from '@/routes/auth.routes';
import { accountRoutes } from '@/routes/account.routes';
import { serverRoutes } from '@/routes/server.routes';
import { adminRoutes } from '@/routes/admin.routes';

import AuthLayout from '@/layouts/AuthLayout';
import DashboardLayout from '@/layouts/DashboardLayout';
import ServerLayout from '@/layouts/ServerLayout';
import AdminLayout from '@/layouts/AdminLayout';
import LandingPage from '@/pages/landing/LandingPage';
import Placeholder from '@/pages/_shared/Placeholder';
import NotFound from '@/pages/NotFound';

// Resolve a registry entry to an element: built page, or the shared placeholder.
function resolveElement(r: RouteDef): ReactElement {
    if (r.element) return createElement(r.element);
    return <Placeholder title={r.name ?? r.path} />;
}

// Map registry entries to react-router child routes ('' -> index route).
function childRoutes(defs: RouteDef[]): RouteObject[] {
    return defs.map(r =>
        r.path === ''
            ? { index: true, element: resolveElement(r) }
            : { path: r.path, element: resolveElement(r) },
    );
}

// Guests see the landing page at /v2; authenticated users go to their dashboard.
function RootEntry() {
    const authenticated = useSession(s => s.isAuthenticated);
    return authenticated ? <Navigate to="/v2/account" replace /> : <LandingPage />;
}

const router = createBrowserRouter([
    { path: '/v2', element: <RootEntry /> },
    { path: '/v2/auth', element: <AuthLayout />, children: childRoutes(authRoutes) },
    { path: '/v2/account', element: <DashboardLayout />, children: childRoutes(accountRoutes) },
    { path: '/v2/server/:id', element: <ServerLayout />, children: childRoutes(serverRoutes) },
    { path: '/v2/admin', element: <AdminLayout />, children: childRoutes(adminRoutes) },
    { path: '*', element: <NotFound /> },
]);

export function App() {
    // Re-key the router on a live locale switch so the whole tree re-renders and
    // every compiled message re-evaluates in the new language (no page reload).
    const locale = useSyncExternalStore(subscribeLocale, getCurrentLocale, getCurrentLocale);
    return <RouterProvider key={locale} router={router} />;
}
