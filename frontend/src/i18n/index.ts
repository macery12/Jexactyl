// Translation entrypoint for the V2 UI (Paraglide JS).
//
// Strings live in ../../messages/<locale>.json and are compiled to typed message
// locale modules under src/paraglide (see vite.config.ts / `pnpm build`). The
// browser loads exactly one locale before React renders; components call the
// typed facade in ./messages. The JSON catalogs remain the only editing surface.
//
// Importing this module also installs the panel's locale resolution (below), so
// main.tsx imports it for its side effects before first render.

import { cloneElement, type ReactElement, type ReactNode } from 'react';
import {
    overwriteGetLocale,
    overwriteSetLocale,
    setLocale as setParaglideLocale,
    locales,
    baseLocale,
    type Locale,
} from '@/paraglide/runtime';
import { initializeMessages } from './messages';

// Extension UI packages use this stable entrypoint because their message ids do
// not exist in the core typed catalog until the package is installed.
export { td } from './messages';

/**
 * Render a message that embeds simple paired tags — e.g.
 * "I agree to the <terms>Terms</terms>" — by replacing each `<tag>…</tag>` with
 * the matching React element (cloned with the inner text as its children). Text
 * outside the tags is kept as-is. This is the Paraglide stand-in for the rare
 * i18next `<Trans components={…} />` strings that carry links/markup; tags are
 * non-nesting, which covers every such string in the panel.
 */
export function formatTags(message: string, components: Record<string, ReactElement>): ReactNode[] {
    const nodes: ReactNode[] = [];
    const tag = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let lastIndex = 0;
    let key = 0;
    let match: RegExpExecArray | null;
    while ((match = tag.exec(message))) {
        if (match.index > lastIndex) nodes.push(message.slice(lastIndex, match.index));
        const name = match[1] ?? '';
        const inner = match[2] ?? '';
        const element = components[name];
        nodes.push(element ? cloneElement(element, { key: key++ }, inner) : inner);
        lastIndex = tag.lastIndex;
    }
    if (lastIndex < message.length) nodes.push(message.slice(lastIndex));
    return nodes;
}

function isSupported(value: string | null | undefined): value is Locale {
    return !!value && (locales as readonly string[]).includes(value);
}

// Resolve the active locale. Precedence:
//   1. the user's own choice (users.language, picked on /settings) — but only
//      while admins allow it (SiteConfiguration.user_locale / app:user_locale),
//   2. the GLOBAL default admins set on /admin/settings
//      (window.SiteConfiguration.locale, backed by the app:locale setting),
//   3. the base locale ('en').
// We intentionally do NOT read localStorage: the account is the source of truth
// so a user's choice follows them across browsers, and a stale per-browser
// value can never mask the global default.
// Anything not in `locales` is ignored so we never boot into a missing catalog.
function resolveLocale(): Locale {
    const candidates = [
        window.SiteConfiguration?.user_locale !== false ? window.PterodactylUser?.language : null,
        window.SiteConfiguration?.locale,
    ];
    for (const c of candidates) {
        if (isSupported(c)) return c;
    }
    return baseLocale;
}

/**
 * The locale the panel falls back to when a user has no (allowed) preference —
 * the admin-set global default, or the base locale. Used by the account picker
 * to switch live when the user clears their preference.
 */
export function panelDefaultLocale(): Locale {
    const global = window.SiteConfiguration?.locale;
    return isSupported(global) ? global : baseLocale;
}

let currentLocale: Locale = resolveLocale();

// React subscribers, so calling setLocale() at runtime re-renders the app in the
// new language WITHOUT a full page reload (App.tsx keys the router off this).
// Used after an admin saves a new global default on the settings page.
const localeListeners = new Set<() => void>();
export function subscribeLocale(listener: () => void): () => void {
    localeListeners.add(listener);
    return () => localeListeners.delete(listener);
}
export function getCurrentLocale(): Locale {
    return currentLocale;
}

// Drive Paraglide off our own resolution rather than its cookie/URL strategies,
// keeping the exact Blade→JS precedence the rest of bootstrap uses.
overwriteGetLocale(() => currentLocale);
overwriteSetLocale((locale) => {
    currentLocale = locale;
    // Keep <html lang> in sync for a11y + correct CSS :lang() / hyphenation.
    document.documentElement.lang = locale;
    localeListeners.forEach((l) => l());
});

document.documentElement.lang = currentLocale;

// Runtime locale switch (routes through the overwritten setter above, which
// notifies subscribers so the UI re-renders live). Changing the language is a
// global, admin-driven action today; this is also the seam a future per-user
// picker would use.
export async function setLocale(locale: Locale): Promise<void> {
    await initializeMessages(locale);
    setParaglideLocale(locale);
}
