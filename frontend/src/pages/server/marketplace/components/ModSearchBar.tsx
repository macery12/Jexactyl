import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { m } from '@/i18n/messages';
import { getMinecraftVersions, type ModFilterOptions, type ServerModsConfig, type Source } from '@/api/mods';
import { MOD_LOADERS, PLATFORMS } from '../modMeta';

export interface ModFilters {
    search: string;
    gameVersion?: string;
    modLoaderType?: number;
    platform?: string;
    sortField?: string;
    categoryId?: number;
    minRating?: number;
}

// Search + filter chrome. Which filters render depends on the source: Modrinth
// exposes version/loader/platform + sort; Spigot exposes category/rating + sort.
// Category/sort/rating option lists are provider-driven (from the search
// response), passed down as `options`.
export function ModSearchBar({
    serverId,
    source,
    resource,
    filters,
    onChange,
    options,
    detected,
    showAll,
    onToggleShowAll,
}: {
    serverId: string;
    source: Source;
    resource: 'mods' | 'plugins';
    filters: ModFilters;
    onChange: (next: ModFilters) => void;
    options?: ModFilterOptions;
    detected: ServerModsConfig | null;
    showAll: boolean;
    onToggleShowAll: () => void;
}) {
    // Local, debounced search text so keystrokes don't refetch on every char.
    const [text, setText] = useState(filters.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
    useEffect(() => setText(filters.search), [filters.search]);
    useEffect(() => {
        const t = setTimeout(() => {
            if (text !== filters.search) onChange({ ...filters, search: text });
        }, 400);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text]);

    const isModrinth = source === 'modrinth';

    const versionsQ = useQuery({
        queryKey: ['mods', serverId, 'mc-versions', source, resource],
        queryFn: () => getMinecraftVersions(serverId, source, resource),
        enabled: isModrinth,
        staleTime: 60 * 60_000,
    });

    const versionOptions = useMemo(
        () => [
            { value: '', label: m['server.mods.filter.anyVersion']() },
            ...(versionsQ.data?.data ?? []).map(v => ({ value: v.versionString, label: v.versionString })),
        ],
        [versionsQ.data],
    );

    const set = (patch: Partial<ModFilters>) => onChange({ ...filters, ...patch });

    const hasDetected = !!(detected?.detectedVersion || detected?.detectedLoader || detected?.detectedPlatform);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={m['server.mods.filter.searchPlaceholder']()}
                        className="pl-9"
                    />
                    {text && (
                        <button
                            type="button"
                            onClick={() => setText('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                            aria-label={m['server.mods.filter.clear']()}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {hasDetected && !showAll && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--brand)]" />
                    <span>{m['server.mods.filter.detected']()}</span>
                    {detected?.detectedVersion && (
                        <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-medium text-[var(--color-ink)]">
                            {detected.detectedVersion}
                        </span>
                    )}
                    {detected?.detectedLoader && (
                        <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-medium text-[var(--color-ink)]">
                            {detected.detectedLoader.name}
                        </span>
                    )}
                    {detected?.detectedPlatform && (
                        <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-medium text-[var(--color-ink)]">
                            {detected.detectedPlatform}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onToggleShowAll}
                        className="ml-auto font-medium text-[var(--brand)] hover:underline"
                    >
                        {m['server.mods.filter.showAll']()}
                    </button>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {isModrinth && (
                    <div className="w-40">
                        <Select
                            value={filters.gameVersion ?? ''}
                            onChange={v => set({ gameVersion: v || undefined })}
                            options={versionOptions}
                            placeholder={m['server.mods.filter.anyVersion']()}
                        />
                    </div>
                )}
                {isModrinth && resource === 'mods' && (
                    <div className="w-36">
                        <Select
                            value={filters.modLoaderType ? String(filters.modLoaderType) : ''}
                            onChange={v => set({ modLoaderType: v ? Number(v) : undefined })}
                            options={[
                                { value: '', label: m['server.mods.filter.anyLoader']() },
                                ...MOD_LOADERS.map(l => ({ value: String(l.id), label: l.label })),
                            ]}
                            placeholder={m['server.mods.filter.anyLoader']()}
                        />
                    </div>
                )}
                {isModrinth && resource === 'plugins' && (
                    <div className="w-40">
                        <Select
                            value={filters.platform ?? ''}
                            onChange={v => set({ platform: v || undefined })}
                            options={[
                                { value: '', label: m['server.mods.filter.anyPlatform']() },
                                ...PLATFORMS.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })),
                            ]}
                            placeholder={m['server.mods.filter.anyPlatform']()}
                        />
                    </div>
                )}
                {!isModrinth && (options?.categories?.length ?? 0) > 0 && (
                    <div className="w-44">
                        <Select
                            value={filters.categoryId ? String(filters.categoryId) : ''}
                            onChange={v => set({ categoryId: v ? Number(v) : undefined })}
                            options={[
                                { value: '', label: m['server.mods.filter.anyCategory']() },
                                ...(options?.categories ?? []).map(c => ({ value: String(c.id), label: c.name })),
                            ]}
                            placeholder={m['server.mods.filter.anyCategory']()}
                        />
                    </div>
                )}
                {!isModrinth && (options?.minRating?.length ?? 0) > 0 && (
                    <div className="w-36">
                        <Select
                            value={filters.minRating != null ? String(filters.minRating) : ''}
                            onChange={v => set({ minRating: v ? Number(v) : undefined })}
                            options={(options?.minRating ?? []).map(r => ({
                                value: r.id != null ? String(r.id) : '',
                                label: r.label,
                            }))}
                            placeholder={m['server.mods.filter.anyRating']()}
                        />
                    </div>
                )}
                {(options?.sortBy?.length ?? 0) > 0 && (
                    <div className="w-40">
                        <Select
                            value={filters.sortField ?? ''}
                            onChange={v => set({ sortField: v || undefined })}
                            options={(options?.sortBy ?? []).map(s => ({ value: s.id, label: s.label }))}
                            placeholder={m['server.mods.filter.sort']()}
                        />
                    </div>
                )}
                {showAll && hasDetected && (
                    <Button variant="ghost" size="sm" onClick={onToggleShowAll}>
                        {m['server.mods.filter.useDetected']()}
                    </Button>
                )}
            </div>
        </div>
    );
}
