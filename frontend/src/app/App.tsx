import { createElement, useSyncExternalStore, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, type RouteObject } from 'react-router-dom';
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
import FeatureDisabled from '@/pages/_shared/FeatureDisabled';
import AccessDenied from '@/pages/_shared/AccessDenied';
import RouteError from '@/pages/_shared/RouteError';
import NotFound from '@/pages/NotFound';
import { can } from '@/lib/can';
import { BASE } from '@/lib/base';
import { RequireAdminPermission } from '@/components/permissions/RequireAdminPermission';
import { useServer } from '@/components/server/ServerContext';

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

// Which permission set a route's `permission` is checked against. Admin and
// server hold entirely different sets, and account/auth routes are never gated
// (V1 declares `permission` only on its server and admin route types), so the
// area has to be threaded down from the mount rather than inferred per route.
type Area = 'admin' | 'server' | 'open';

// Enforce a route's `permission` for the server area, where the held set is the
// subuser's real permission list off the server model — already loaded by
// ServerLayout before it renders this subtree, so there's no loading state to
// wait on. The admin equivalent is RequireAdminPermission, which does have one.
function ServerPermissionGate({ def, children }: { def: RouteDef; children: ReactElement }) {
    const server = useServer();
    if (!can(server.permissions, def.permission)) return <AccessDenied permission={def.permission} />;
    return children;
}

// Resolve a registry entry to an element, wrapping it in its gates.
// Gate order matters and mirrors V1, which filtered by `condition` before
// wrapping in a permission guard: a module that is switched off reads as
// "disabled" to everyone, rather than telling an under-privileged user they lack
// a permission that would not help them anyway.
function resolveElement(r: RouteDef, area: Area): ReactElement {
    let el = createElement(r.element);
    if (r.permission && area !== 'open') {
        el =
            area === 'admin' ? (
                <RequireAdminPermission permission={r.permission}>{el}</RequireAdminPermission>
            ) : (
                <ServerPermissionGate def={r}>{el}</ServerPermissionGate>
            );
    }
    if (r.condition) return <FeatureGate def={r}>{el}</FeatureGate>;
    return el;
}

// Map registry entries to react-router child routes ('' -> index route).
function childRoutes(defs: RouteDef[], area: Area): RouteObject[] {
    return defs.map(r =>
        r.path === ''
            ? { index: true, element: resolveElement(r, area) }
            : { path: r.path, element: resolveElement(r, area) },
    );
}

// The account area mounts at the site root and the dashboard is its index.
// The root URL is shared with the guest-facing landing page, so the element
// is picked per location: a guest on exactly '/' gets the landing page (or
// sign-in when the operator has disabled it); every other case renders the
// dashboard shell, whose RequireAuth bounces guests to login.
function RootArea() {
    const authenticated = useSession(s => s.isAuthenticated);
    const landing = useFlags(s => s.landing);
    const location = useLocation();
    if (!authenticated && location.pathname === '/') {
        if (landing && !landing.enabled) return <Navigate to="/auth/login" replace />;
        return <LandingPage />;
    }
    return <DashboardLayout />;
}

// Every top-level route carries `errorElement` so an uncaught render error in
// any child subtree surfaces the panel-styled RouteError fallback (with a reload
// / back-home escape) instead of react-router's bare default error screen.
const router = createBrowserRouter(
    [
        { path: '/auth', element: <AuthLayout />, errorElement: <RouteError />, children: childRoutes(authRoutes, 'open') },
        { path: '/server/:id', element: <ServerLayout />, errorElement: <RouteError />, children: childRoutes(serverRoutes, 'server') },
        { path: '/admin', element: <AdminLayout />, errorElement: <RouteError />, children: childRoutes(adminRoutes, 'admin') },
        { path: '/', element: <RootArea />, errorElement: <RouteError />, children: childRoutes(accountRoutes, 'open') },
        { path: '*', element: <NotFound />, errorElement: <RouteError /> },
    ],
    { basename: BASE },
);

export function App() {
    // Re-key the router on a live locale switch so the whole tree re-renders and
    // every compiled message re-evaluates in the new language (no page reload).
    const locale = useSyncExternalStore(subscribeLocale, getCurrentLocale, getCurrentLocale);
    return <RouterProvider key={locale} router={router} />;
}
