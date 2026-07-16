import { Download, Star, Package } from 'lucide-react';
import type { Mod } from '@/api/mods';
import { formatCount, primaryAuthor } from '../modMeta';

// A single mod / plugin / modpack tile. Fixed height so the virtualized grid's
// row estimate stays accurate and icons don't cause layout shift.
export function ModCard({ mod, onSelect }: { mod: Mod; onSelect: (mod: Mod) => void }) {
    const icon = mod.logo?.thumbnailUrl || mod.logo?.url || null;
    const rating = mod.rating?.average ?? mod.latestVersion?.rating?.average;

    return (
        <button
            type="button"
            onClick={() => onSelect(mod)}
            className="group flex h-[156px] w-full flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--color-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
        >
            <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    {icon ? (
                        <img
                            src={icon}
                            alt=""
                            loading="lazy"
                            width={48}
                            height={48}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <Package className="h-5 w-5 text-[var(--color-ink-faint)]" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">{mod.name}</h3>
                    <p className="truncate text-xs text-[var(--color-ink-muted)]">{primaryAuthor(mod.authors)}</p>
                </div>
            </div>

            <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                {mod.summary}
            </p>

            <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--color-ink-faint)]">
                <span className="inline-flex items-center gap-1">
                    <Download className="h-3 w-3" />
                    {formatCount(mod.downloadCount)}
                </span>
                {typeof rating === 'number' && rating > 0 && (
                    <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        {rating.toFixed(1)}
                    </span>
                )}
            </div>
        </button>
    );
}
