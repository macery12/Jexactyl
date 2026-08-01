import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { EverestConfiguration } from '@/lib/globals';

export type Flags = EverestConfiguration;

export type ServerCategory = 'general' | 'data' | 'configuration';
export type AdminCategory = 'general' | 'access' | 'developers' | 'modules' | 'management' | 'extensions';

export interface RouteDef {
    /** Path relative to the area mount (e.g. '', 'credentials', 'files/*'). */
    path: string;
    /** Nav label. Routes without a name are reachable but hidden from nav. */
    name?: string;
    icon?: LucideIcon;
    /** Sidebar grouping (server + admin areas). */
    category?: ServerCategory | AdminCategory;
    /** Dotted permission(s) required to see/visit this route. */
    permission?: string | string[];
    /** Feature-flag gate; hidden when it returns false. */
    condition?: (flags: Flags) => boolean;
    /** Exact-match route (React Router `index`/`end`). */
    end?: boolean;
    /** The page component. Every registry entry has one. */
    element: LazyExoticComponent<ComponentType> | ComponentType;
}

/** Small helper mirroring V1's route() so entries read declaratively. */
export function route(path: string, opts: Omit<RouteDef, 'path'>): RouteDef {
    return { path, ...opts };
}
