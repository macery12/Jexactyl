/// <reference types="vite/client" />
import React from 'react';

export interface ExtensionRouteDefinition {
    id: string;
    route: string;
    component: React.LazyExoticComponent<() => JSX.Element>;
}

const staticRoutes: ExtensionRouteDefinition[] = [];

type PackageMeta = {
    id: string;
    route?: string;
};

const packageMetas = import.meta.glob('../../../extensions/packages/**/meta.json', {
    eager: true,
    import: 'default',
}) as Record<string, PackageMeta>;
const packageComponents = import.meta.glob('../../../extensions/packages/**/index.tsx') as Record<
    string,
    () => Promise<{ default: () => JSX.Element }>
>;

const staticIds = new Set(staticRoutes.map(route => route.id));
const dynamicRoutes = Object.entries(packageMetas)
    .map(([path, meta]) => {
        const componentPath = path.replace(/meta\.json$/, 'index.tsx');
        const loader = packageComponents[componentPath];

        if (!loader || !meta?.id || staticIds.has(meta.id)) {
            return null;
        }

        return {
            id: meta.id,
            route: meta.route || meta.id,
            component: React.lazy(loader),
        } satisfies ExtensionRouteDefinition;
    })
    .filter((route): route is ExtensionRouteDefinition => route !== null);

export const extensionRoutes: ExtensionRouteDefinition[] = [...staticRoutes, ...dynamicRoutes];
