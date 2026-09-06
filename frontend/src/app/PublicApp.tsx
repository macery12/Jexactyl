import { createElement, lazy, Suspense, useSyncExternalStore, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { subscribeLocale, getCurrentLocale } from '@/i18n';
import { useFlags } from '@/state/flags';
import type { RouteDef } from '@/routes/registry';
import { authRoutes } from '@/routes/auth.routes';
import LandingPage from '@/pages/landing/LandingPage';
import FeatureDisabled from '@/pages/_shared/FeatureDisabled';
import RouteError from '@/pages/_shared/RouteError';
import { BASE } from '@/lib/base';
import { FullPageSpinner } from '@/components/ui/Spinner';

const AuthLayout = lazy(() => import('@/layouts/AuthLayout'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function deferred(element: ReactElement): ReactElement {
    return <Suspense fallback={<FullPageSpinner />}>{element}</Suspense>;
}

function FeatureGate({ def, children }: { def: RouteDef; children: ReactElement }) {
    const flags = useFlags(state => state.everest);
    if (def.condition && flags && !def.condition(flags)) {
        return <FeatureDisabled name={def.name} />;
    }
    return children;
}

function childRoutes(defs: RouteDef[]): RouteObject[] {
    return defs.map(def => {
        const element = createElement(def.element);
        const gated = def.condition ? <FeatureGate def={def}>{element}</FeatureGate> : element;
        return def.path === '' ? { index: true, element: gated } : { path: def.path, element: gated };
    });
}

function PublicLanding() {
    const landing = useFlags(state => state.landing);
    if (landing && !landing.enabled) return <Navigate to="/auth/login" replace />;
    return <LandingPage />;
}

const router = createBrowserRouter(
    [
        {
            path: '/auth',
            element: deferred(<AuthLayout />),
            errorElement: <RouteError />,
            children: childRoutes(authRoutes),
        },
        { path: '/', element: <PublicLanding />, errorElement: <RouteError /> },
        { path: '*', element: deferred(<NotFound />), errorElement: <RouteError /> },
    ],
    { basename: BASE },
);

export function App() {
    const locale = useSyncExternalStore(subscribeLocale, getCurrentLocale, getCurrentLocale);
    return <RouterProvider key={locale} router={router} />;
}
