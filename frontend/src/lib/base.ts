// Single source of truth for the URL prefix the SPA is served under.
//
// Router APIs (<Link>, <Navigate>, navigate(), route paths) take base-relative
// paths ('/billing/...') — the router's `basename` adds the prefix. Everything
// that bypasses the router (raw <a href>, window.location, URLs handed to
// payment providers) must go through abs() instead.
//
// V2 serves at the site root (since Phase 2 of the V1 cutover). Set a prefix
// here (e.g. '/v2') to move the whole SPA under one — routes, links and
// non-router URLs all derive from this constant.
export const BASE = '';

// Absolute URL path for a base-relative path, for non-router uses.
export function abs(path: string = '/'): string {
    return `${BASE}${path}` || '/';
}
