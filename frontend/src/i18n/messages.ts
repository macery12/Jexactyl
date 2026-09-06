import { baseLocale, type Locale } from '@/paraglide/runtime';
import { catalogLoaders, publicCatalogLoaders, type RuntimeCatalog } from './generated/catalogLoaders';
import type { MessageFunctions } from './generated/messageTypes';

type MessageFunction = (inputs?: Record<string, unknown>) => string;

let activeCatalog: RuntimeCatalog | null = null;
const resolvedFunctions = new Map<string, MessageFunction>();

/** Convert a dotted message id to Paraglide's generated locale export name. */
export function compiledMessageName(id: string): string {
    const uppercaseCount = id.match(/[A-Z]/g)?.length ?? 0;
    const normalized = id.replace(/[^A-Za-z0-9_$]/g, '_').toLowerCase();
    return uppercaseCount === 0 ? normalized : `${normalized}${uppercaseCount}`;
}

/**
 * Stable, typed message facade backed directly by the active Paraglide module.
 * Resolving properties on demand removes the generated id-map wrapper and the
 * startup copy of every catalog function while preserving synchronous m.foo().
 */
export const m = new Proxy(Object.create(null) as MessageFunctions, {
    get(_target, property) {
        if (typeof property !== 'string') return undefined;

        const cached = resolvedFunctions.get(property);
        if (cached) return cached;

        const message = activeCatalog?.[compiledMessageName(property)];
        if (message) resolvedFunctions.set(property, message);
        return message;
    },
});

let loadedLocale: Locale | null = null;
let loadedScope: CatalogScope | null = null;
let loadSequence = 0;

export type CatalogScope = 'full' | 'public';

/** Load exactly one compiled locale and atomically replace the active catalog. */
export async function initializeMessages(locale: Locale, scope: CatalogScope = 'full'): Promise<void> {
    if (loadedLocale === locale && (loadedScope === 'full' || loadedScope === scope)) return;

    const sequence = loadSequence++;
    const startMark = `m12:i18n:${locale}:${sequence}:start`;
    const endMark = `m12:i18n:${locale}:${sequence}:end`;
    performance.mark(startMark, { detail: { locale } });
    const loaders = scope === 'public' ? publicCatalogLoaders : catalogLoaders;
    const loader = loaders[locale] ?? loaders[baseLocale];
    const catalog = await loader();
    activeCatalog = catalog;
    resolvedFunctions.clear();
    loadedLocale = locale;
    loadedScope = scope;
    performance.mark(endMark, { detail: { locale, scope, messages: Object.keys(catalog).length } });
    performance.measure(`m12:i18n:${locale}`, startMark, endMark);
}

/** Resolve a finite message id assembled at runtime. */
export function td(id: string, fallback?: string): string {
    const fn = (m as unknown as RuntimeCatalog)[id];
    return fn ? fn() : fallback ?? id;
}
