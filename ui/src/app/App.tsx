import { createElement, useSyncExternalStore, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { subscribeLocale, getCurrentLocale } from '@/i18n';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
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
import FeatureDisabled from '@/pages/_shared/FeatureDisabled';
import NotFound from '@/pages/NotFound';

// Enforce a route's feature-flag `condition` on direct access. The sidebar
// already hides gated-off tabs (buildNav), but the router still maps every
// path, so a typed URL would otherwise render a disabled module's page. When
// flags haven't loaded yet we fail open (mirrors buildNav's null-flags check).
function FeatureGate({ def, children }: { def: RouteDef; children: ReactElement }) {
    const flags = useFlags(s => s.everest);
    if (def.condition && flags && !def.condition(flags)) {
        return <FeatureDisabled name={def.name} />;
    }
    return children;
}

// Resolve a registry entry to an element: built page, or the shared placeholder.
function resolveElement(r: RouteDef): ReactElement {
    const el = r.element ? createElement(r.element) : <Placeholder title={r.name ?? r.path} />;
    if (r.condition) return <FeatureGate def={r}>{el}</FeatureGate>;
    return el;
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
// When the operator has disabled the landing page entirely, guests are sent
// straight to sign-in — the landing page is never shown or routed to.
function RootEntry() {
    const authenticated = useSession(s => s.isAuthenticated);
    const landing = useFlags(s => s.landing);
    if (authenticated) return <Navigate to="/v2/account" replace />;
    if (landing && !landing.enabled) return <Navigate to="/v2/auth/login" replace />;
    return <LandingPage />;
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
