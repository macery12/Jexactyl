import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, FileBox, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { m, td } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { formatBytes, timeAgo } from '@/lib/format';
import { useFlashes } from '@/state/flashes';
import {
    getInstalledAddons,
    toggleInstalledAddon,
    type InstalledContentType,
    type InstalledStatusFilter,
    type InstalledAddon,
} from '@/api/mods';

const PER_PAGE = 50;
const STATUSES: InstalledStatusFilter[] = ['all', 'enabled', 'disabled'];

// Installed mods/plugins manager: type + status filters, debounced search,
// paginated list, optimistic enable/disable toggle.
export function InstalledAddons({ serverId }: { serverId: string }) {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const [type, setType] = useState<InstalledContentType>('mods');
    const [status, setStatus] = useState<InstalledStatusFilter>('all');
    const [page, setPage] = useState(1);
    const [text, setText] = useState('');
    const [search, setSearch] = useState('');

    // Debounce the search box; reset to page 1 whenever the query changes.
    useEffect(() => {
        const t = setTimeout(() => setSearch(text), 250);
        return () => clearTimeout(t);
    }, [text]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
    useEffect(() => setPage(1), [type, status, search]);

    const queryKey = useMemo(
        () => ['installedAddons', serverId, type, status, search, page] as const,
        [serverId, type, status, search, page],
    );

    const listQ = useQuery({
        queryKey,
        queryFn: () => getInstalledAddons(serverId, { type, status, search, page, perPage: PER_PAGE }),
        placeholderData: keepPreviousData,
    });

    const toggle = useMutation({
        mutationFn: (addon: InstalledAddon) =>
            toggleInstalledAddon(serverId, { type, path: addon.path, enable: !addon.enabled }),
        onMutate: async addon => {
            await qc.cancelQueries({ queryKey });
            const prev = qc.getQueryData(queryKey);
            qc.setQueryData(queryKey, (old: Awaited<ReturnType<typeof getInstalledAddons>> | undefined) =>
                old
                    ? { ...old, items: old.items.map(i => (i.path === addon.path ? { ...i, enabled: !i.enabled } : i)) }
                    : old,
            );
            return { prev };
        },
        onError: (err, _addon, ctx) => {
            if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
            push({ type: 'error', message: firstError(err) ?? m['server.mods.error']() });
        },
        onSettled: () => qc.invalidateQueries({ queryKey }),
    });

    const items = listQ.data?.items ?? [];
    const pagination = listQ.data?.pagination;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
                    {(['mods', 'plugins'] as InstalledContentType[]).map(t => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setType(t)}
                            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                type === t
                                    ? 'bg-[var(--brand)]/15 text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
                            }`}
                        >
                            {td(`server.mods.installed.type.${t}`)}
                        </button>
                    ))}
                </div>
                <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
                    {STATUSES.map(s => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setStatus(s)}
                            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                status === s
                                    ? 'bg-[var(--brand)]/15 text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
                            }`}
                        >
                            {td(`server.mods.installed.status.${s}`)}
                        </button>
                    ))}
                </div>
                <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={m['server.mods.installed.searchPlaceholder']()}
                        className="pl-9"
                    />
                </div>
            </div>

            {listQ.isLoading ? (
                <div className="flex justify-center py-16">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : listQ.isError ? (
                <div className="py-16 text-center text-sm text-[var(--color-danger)]">
                    {firstError(listQ.error) ?? m['server.mods.error']()}
                </div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-sm text-[var(--color-ink-faint)]">
                    <FileBox className="h-6 w-6" />
                    {m['server.mods.installed.empty']()}
                </div>
            ) : (
                <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)]">
                    {items.map(addon => (
                        <li key={addon.path} className="flex items-center gap-3 bg-[var(--color-surface)] px-4 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-[var(--color-ink)]">{addon.friendlyName || addon.filename}</p>
                                <p className="truncate text-xs text-[var(--color-ink-faint)]">
                                    {formatBytes(addon.sizeBytes)}
                                    {addon.modifiedAt && ` · ${timeAgo(addon.modifiedAt)}`}
                                </p>
                            </div>
                            <Switch
                                checked={addon.enabled}
                                onChange={() => toggle.mutate(addon)}
                                label={addon.enabled ? m['server.mods.installed.disable']() : m['server.mods.installed.enable']()}
                            />
                        </li>
                    ))}
                </ul>
            )}

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between text-sm text-[var(--color-ink-muted)]">
                    <span>
                        {m['server.mods.installed.pageOf']({ page: pagination.currentPage, total: pagination.totalPages })}
                    </span>
                    <div className="flex gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage <= 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage >= pagination.totalPages}
                            onClick={() => setPage(p => p + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
