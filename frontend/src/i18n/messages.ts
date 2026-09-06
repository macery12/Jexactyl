import { baseLocale, type Locale } from '@/paraglide/runtime';
import { catalogLoaders, type RuntimeCatalog } from './generated/catalogLoaders';
import type { MessageFunctions } from './generated/messageTypes';

/** Stable, typed message object populated before React renders. */
export const m = {} as MessageFunctions;

let loadedLocale: Locale | null = null;
let loadSequence = 0;

/** Load exactly one compiled locale and atomically replace the active catalog. */
export async function initializeMessages(locale: Locale): Promise<void> {
    if (loadedLocale === locale) return;

    const sequence = loadSequence++;
    const startMark = `m12:i18n:${locale}:${sequence}:start`;
    const endMark = `m12:i18n:${locale}:${sequence}:end`;
    performance.mark(startMark, { detail: { locale } });
    const loader = catalogLoaders[locale] ?? catalogLoaders[baseLocale];
    const { default: catalog } = await loader();
    const target = m as unknown as RuntimeCatalog;

    for (const id of Object.keys(target)) delete target[id];
    Object.assign(target, catalog);
    loadedLocale = locale;
    performance.mark(endMark, { detail: { locale, messages: Object.keys(catalog).length } });
    performance.measure(`m12:i18n:${locale}`, startMark, endMark);
}

/** Resolve a finite message id assembled at runtime. */
export function td(id: string, fallback?: string): string {
    const fn = (m as unknown as RuntimeCatalog)[id];
    return fn ? fn() : fallback ?? id;
}
