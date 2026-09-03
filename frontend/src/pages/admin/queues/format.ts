/**
 * Shared figure formatting for the queue pages.
 *
 * Horizon reports 0 for "never measured", which would read as "instant" -- the
 * one number on this page that must never be wrong by that much.
 */
export function formatMs(value: number | null): string {
    if (value === null || value <= 0) return '—';

    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

/** Seconds as a duration an operator reads at a glance: 41m, 2h 10m, 8s. */
export function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds < 0) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);

    return `${hours}h ${minutes % 60}m`;
}
