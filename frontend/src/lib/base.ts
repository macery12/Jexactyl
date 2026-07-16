// Single source of truth for the URL prefix the SPA is served under.
//
// Router APIs (<Link>, <Navigate>, navigate(), route paths) take base-relative
// paths ('/account/...') — the router's `basename` adds the prefix. Everything
// that bypasses the router (raw <a href>, window.location, URLs handed to
// payment providers) must go through abs() instead.
//
// Flips to '' when V2 takes the site root (Phase 2 of the V1 cutover).
export const BASE = '/v2';

// Absolute URL path for a base-relative path, for non-router uses.
export function abs(path: string = '/'): string {
    return `${BASE}${path}` || '/';
}
