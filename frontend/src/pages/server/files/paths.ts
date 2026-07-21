// Path helpers for the file manager. Ported from V1's lib/helpers.ts so the
// hash-based directory navigation and editor URLs behave identically.

export const cleanDirectoryPath = (path: string): string => path.replace(/(\/(\/*))|(^$)/g, '/');

// URL-encodes each segment of a path, preserving the slashes (for editor URLs).
export function encodePathSegments(path: string): string {
    return path
        .split('/')
        .map(s => encodeURIComponent(s))
        .join('/');
}

// The browser stores its current directory in the URL hash (e.g. `#/plugins`).
export function hashToPath(hash: string): string {
    return hash.length > 0 ? decodeURIComponent(hash.substring(1)) : '/';
}

// Directory portion of a full file path (like node's `path.dirname`).
export function dirname(path: string): string {
    const trimmed = path.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0) return '/';
    return trimmed.slice(0, idx);
}

// Joins a directory and a name into a normalised absolute path.
export function joinPath(directory: string, name: string): string {
    return cleanDirectoryPath(`${directory}/${name}`);
}

// Joins path segments and collapses redundant slashes. Callers validate against
// `..` before this runs (see validateFileName), so no traversal resolution here.
export function join(...segments: string[]): string {
    return segments
        .join('/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/+$/, '') || '/';
}

// Breadcrumb segments for a directory, each with its cumulative path.
export function breadcrumbSegments(directory: string): { label: string; path: string }[] {
    const parts = directory.split('/').filter(Boolean);
    let cumulative = '';
    return parts.map(part => {
        cumulative += `/${part}`;
        return { label: part, path: cumulative };
    });
}
