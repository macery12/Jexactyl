import { m, td } from '@/i18n';
import { AlertTriangle, ArrowUpCircle, BadgeCheck, Check, ChevronDown, ChevronUp, ChevronsUpDown, Download, Settings2 } from 'lucide-react';
import type { Extension } from '@/api/extensions';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { extensionTone, resolveExtensionIcon, toneVar, type ExtensionTone } from './extMeta';

const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;

export type SortKey = 'name' | 'type' | 'status' | 'version';
export interface Sort {
    key: SortKey;
    dir: 'asc' | 'desc';
}

// Status column label. Unlike the shared tone-label helper, the table
// distinguishes an installed-but-disabled extension ("Disabled") from a live
// one ("Enabled"), since the status column carries that state on its own.
function statusLabel(tone: ExtensionTone): string {
    switch (tone) {
        case 'update':
            // Compact label — the status column is narrow and "Update available"
            // wrapped to two lines. The amber arrow icon carries the rest.
            return td('extensions.status.updateShort');
        case 'available':
            return td('extensions.status.available');
        case 'incompatible':
            return td('extensions.status.incompatible');
        case 'core':
            return td('extensions.status.core');
        case 'enabled':
            return td('extensions.status.enabled');
        case 'installed':
        default:
            return td('extensions.status.disabled');
    }
}

function StatusChip({ ext }: { ext: Extension }) {
    const tone = extensionTone(ext);
    const accent = toneVar(tone);
    const incompatible = tone === 'incompatible';
    return (
        <span
            title={incompatible && ext.compatiblePanelVersions.length > 0
                ? m['extensions.incompatible.requires']({ versions: ext.compatiblePanelVersions.join(', ') })
                : undefined}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ background: tint(accent, 12), borderColor: tint(accent, 30), color: accent }}
        >
            {tone === 'update' ? (
                <ArrowUpCircle className="h-3 w-3" />
            ) : incompatible ? (
                <AlertTriangle className="h-3 w-3" />
            ) : (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} aria-hidden />
            )}
            {statusLabel(tone)}
        </span>
    );
}

function SortHeader({
    label,
    col,
    sort,
    onSort,
    className,
}: {
    label: string;
    col: SortKey;
    sort: Sort;
    onSort: (key: SortKey) => void;
    className?: string;
}) {
    const active = sort.key === col;
    return (
        <th className={cn('px-3 py-2.5', className)}>
            <button
                type="button"
                onClick={() => onSort(col)}
                className={cn(
                    'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
                    active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]',
                )}
            >
                {label}
                {active ? (
                    sort.dir === 'asc' ? (
                        <ChevronUp className="h-3 w-3 text-[var(--brand)]" />
                    ) : (
                        <ChevronDown className="h-3 w-3 text-[var(--brand)]" />
                    )
                ) : (
                    <ChevronsUpDown className="h-3 w-3 opacity-40" />
                )}
            </button>
        </th>
    );
}

export function ExtensionsTable({
    rows,
    selectedIds,
    sort,
    onSort,
    allPageSelected,
    somePageSelected,
    onTogglePage,
    locked,
    togglingId,
    installingId,
    onOpen,
    onToggle,
    onInstall,
    onRowSelect,
}: {
    rows: Extension[];
    selectedIds: Set<string>;
    sort: Sort;
    onSort: (key: SortKey) => void;
    allPageSelected: boolean;
    somePageSelected: boolean;
    onTogglePage: () => void;
    locked: boolean;
    togglingId?: string;
    installingId?: string;
    onOpen: (ext: Extension) => void;
    onToggle: (ext: Extension) => void;
    onInstall: (ext: Extension) => void;
    onRowSelect: (index: number, shiftKey: boolean) => void;
}) {
    return (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                    <tr className="border-b border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/60">
                        <th className="w-10 px-3 py-2.5">
                            <button
                                type="button"
                                onClick={onTogglePage}
                                aria-label={m['extensions.select.selectPage']()}
                                aria-pressed={allPageSelected}
                                className={cn(
                                    'flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors',
                                    allPageSelected || somePageSelected
                                        ? 'border-[var(--brand)] bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                        : 'border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-ink-faint)]',
                                )}
                            >
                                {allPageSelected ? (
                                    <Check className="h-3 w-3" strokeWidth={3} />
                                ) : somePageSelected ? (
                                    <span className="h-0.5 w-2 rounded-full bg-[var(--color-brand-ink)]" />
                                ) : null}
                            </button>
                        </th>
                        <SortHeader label={m['extensions.table.extension']()} col="name" sort={sort} onSort={onSort} />
                        <SortHeader label={m['extensions.table.type']()} col="type" sort={sort} onSort={onSort} className="w-28" />
                        <SortHeader label={m['extensions.table.status']()} col="status" sort={sort} onSort={onSort} className="w-40" />
                        <SortHeader label={m['extensions.table.version']()} col="version" sort={sort} onSort={onSort} className="w-36" />
                        <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                            {m['extensions.table.source']()}
                        </th>
                        <th className="w-px px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                            {m['extensions.table.actions']()}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((ext, index) => {
                        const tone = extensionTone(ext);
                        const accent = toneVar(tone);
                        const Icon = resolveExtensionIcon(ext.icon);
                        const selected = selectedIds.has(ext.id);
                        const installing = installingId === ext.id;
                        const toggling = togglingId === ext.id;
                        return (
                            <tr
                                key={ext.id}
                                onClick={() => onOpen(ext)}
                                className={cn(
                                    'cursor-pointer border-b border-[var(--color-border)] transition-colors last:border-b-0',
                                    selected ? 'bg-[var(--brand)]/10 hover:bg-[var(--brand)]/20' : 'hover:bg-[var(--color-surface-2)]/60',
                                )}
                            >
                                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                    <button
                                        type="button"
                                        onClick={e => onRowSelect(index, (e.nativeEvent as MouseEvent).shiftKey)}
                                        aria-label={m['extensions.select.aria']({ name: ext.name })}
                                        aria-pressed={selected}
                                        className={cn(
                                            'flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors',
                                            selected
                                                ? 'border-[var(--brand)] bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                                : 'border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-ink-faint)]',
                                        )}
                                    >
                                        <Check className="h-3 w-3" strokeWidth={3} />
                                    </button>
                                </td>

                                <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
                                            style={{ background: tint(accent, 12), borderColor: tint(accent, 30), color: accent }}
                                        >
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{ext.name}</div>
                                            <div className="truncate font-mono text-[11px] text-[var(--color-ink-faint)]">{ext.id}</div>
                                        </div>
                                    </div>
                                </td>

                                <td className="px-3 py-2.5">
                                    <span className="rounded border border-[var(--color-border)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                                        {td(`extensions.type.${ext.type}`)}
                                    </span>
                                </td>

                                <td className="px-3 py-2.5">
                                    <StatusChip ext={ext} />
                                </td>

                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                                    v{ext.installed ? ext.version : ext.latestVersion}
                                    {ext.updateAvailable && (
                                        <span className="text-[var(--color-warning)]"> → v{ext.latestVersion}</span>
                                    )}
                                </td>

                                <td className="px-3 py-2.5">
                                    <span className="inline-flex min-w-0 max-w-[16rem] items-center gap-1.5 text-[11px] text-[var(--color-ink-faint)]">
                                        {ext.source.official && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />}
                                        <span className="truncate">{ext.source.label}</span>
                                    </span>
                                </td>

                                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center justify-end gap-2">
                                        {ext.installable ? (
                                            ext.compatible === false ? (
                                                // Repo release the panel can't run — install is blocked
                                                // (the backend rejects it too). Manual uploads bypass this.
                                                <button
                                                    type="button"
                                                    disabled
                                                    title={m['extensions.incompatible.blocked']()}
                                                    className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/40 px-3 text-xs font-medium text-[var(--color-danger)] opacity-90"
                                                >
                                                    <AlertTriangle className="h-3.5 w-3.5" />
                                                    {m['extensions.card.install']()}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => onInstall(ext)}
                                                    disabled={locked || installing}
                                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50"
                                                >
                                                    {installing ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                                                    {m['extensions.card.install']()}
                                                </button>
                                            )
                                        ) : (
                                            <>
                                                <Switch
                                                    checked={ext.enabled}
                                                    disabled={toggling || locked}
                                                    onChange={() => onToggle(ext)}
                                                    label={ext.enabled ? m['extensions.card.disabled']() : m['extensions.card.enabled']()}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => onOpen(ext)}
                                                    aria-label={m['extensions.card.manage']()}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                                >
                                                    <Settings2 className="h-3.5 w-3.5" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
