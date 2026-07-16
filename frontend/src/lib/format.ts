// Bytes -> human string (binary units, matching panel conventions).
export function formatBytes(bytes: number, decimals = 1): string {
    if (!bytes || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : decimals)} ${units[i]}`;
}

// Server-list limits are in MiB (0 == unlimited).
export function formatMib(mib: number): string {
    if (mib === 0) return '∞';
    return mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GB` : `${mib} MB`;
}

export const mibToBytes = (mib: number): number => mib * 1024 * 1024;

// Money formatting for the billing surfaces. The panel's configured currency
// isn't exposed to the V2 frontend yet, so this defaults to USD; swap the code
// once the billing currency is surfaced through the config flags.
export function formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount || 0);
}

// Daemon uptime is milliseconds.
export function formatUptime(ms: number): string {
    if (!ms || ms <= 0) return '—';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// Compact "time ago" without pulling a date library.
export function timeAgo(input: string | number | Date): string {
    const then = new Date(input).getTime();
    const diff = Math.max(0, Date.now() - then);
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(then).toLocaleDateString();
}
