import { m, td } from '@/i18n';

// Shared constants + label helpers for the marketplace UI. Keeps the numeric
// CurseForge-style enums the backend speaks in one place.

// Mod loader ids (CurseForge modLoaderType). Modrinth-only filter.
export const MOD_LOADERS: Array<{ id: number; slug: string; label: string }> = [
    { id: 1, slug: 'forge', label: 'Forge' },
    { id: 4, slug: 'fabric', label: 'Fabric' },
    { id: 5, slug: 'quilt', label: 'Quilt' },
    { id: 6, slug: 'neoforge', label: 'NeoForge' },
];

// Plugin platforms (Modrinth plugins filter).
export const PLATFORMS = [
    'paper',
    'spigot',
    'bukkit',
    'folia',
    'purpur',
    'velocity',
    'waterfall',
    'bungeecord',
    'sponge',
] as const;

// CurseForge release types.
export type ReleaseType = 1 | 2 | 3;

export function releaseTypeLabel(type: number): string {
    return td(`server.mods.release.${type}`, type === 2 ? 'Beta' : type === 3 ? 'Alpha' : 'Release');
}

// Tailwind classes for a release-type chip (theme tokens only).
export function releaseTypeChip(type: number): string {
    if (type === 3) return 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]';
    if (type === 2) return 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]';
    return 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]';
}

// Compact download-count formatting (1.2k / 3.4M) — provider counts get large.
export function formatCount(n: number): string {
    if (!n || n < 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export function providerLabel(key: string): string {
    return td(`server.mods.provider.${key}`, key.charAt(0).toUpperCase() + key.slice(1));
}

// A mod's primary author display name.
export function primaryAuthor(authors: Array<{ name: string }> | undefined): string {
    return authors?.[0]?.name ?? m['server.mods.unknownAuthor']();
}
