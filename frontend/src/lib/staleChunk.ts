// Recovery for stale lazy-loaded chunks. Every `pnpm build` (e.g. an extension
// install/uninstall) replaces the content-hashed files in public/build, so a
// tab still running the previous bundle 404s the moment it lazy-loads a route
// chunk ("Failed to fetch dynamically imported module"). Nothing is wrong with
// the session — the fix is simply a full reload, which refetches the blade
// document and with it the new manifest + chunk URLs.
//
// Two hooks feed this module:
//   - Vite's `vite:preloadError` window event (installStaleChunkGuard, wired in
//     main.tsx) catches most failures before React ever sees them;
//   - RouteError checks isStaleChunkError as a fallback for anything that still
//     reaches the router boundary.
// Both funnel into attemptStaleChunkReload, whose sessionStorage timestamp
// allows at most one automatic reload per minute — if the new bundle is itself
// unfetchable (build still running, server down), the user lands on the normal
// error screen with its manual Reload button instead of a reload loop.

const STORAGE_KEY = 'm12:stale-chunk-reload';
const RETRY_WINDOW_MS = 60_000;

/** Browser messages for a failed dynamic import (Chrome / Firefox / Safari). */
const CHUNK_ERROR = /(failed to fetch|error loading|importing a module script failed).*(dynamically imported module|module script)|dynamically imported module/i;

export function isStaleChunkError(error: unknown): boolean {
    return error instanceof Error && CHUNK_ERROR.test(error.message);
}

/**
 * Reload the page to pick up a fresh build, unless an automatic reload was
 * already attempted within the last minute. Returns true when the reload was
 * initiated (callers should render a quiet "reloading" state, not an error).
 */
export function attemptStaleChunkReload(): boolean {
    let last = 0;
    try {
        last = Number(sessionStorage.getItem(STORAGE_KEY)) || 0;
    } catch {
        // Storage unavailable: still reload — worst case the loop guard is lost
        // for this tab, and the router error screen breaks any cycle anyway.
    }
    if (Date.now() - last < RETRY_WINDOW_MS) return false;

    try {
        sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
        /* see above */
    }
    window.location.reload();
    return true;
}

/**
 * Reload as soon as Vite reports a failed dynamic-import preload, without
 * waiting for the error to bubble into a route boundary. preventDefault stops
 * Vite from also throwing (we are navigating away); when the loop guard vetoes
 * the reload the error is left to propagate so RouteError can render.
 */
export function installStaleChunkGuard(): void {
    window.addEventListener('vite:preloadError', event => {
        if (attemptStaleChunkReload()) event.preventDefault();
    });
}
