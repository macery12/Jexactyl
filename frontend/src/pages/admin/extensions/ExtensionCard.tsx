import { m, td } from '@/i18n';
import { BadgeCheck, ArrowUpCircle, Settings2, Download } from 'lucide-react';
import type { Extension } from '@/api/extensions';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { resolveExtensionIcon, extensionTone, toneVar, toneLabelKey } from './extMeta';

// A tinted translucent surface from a tone var — used for badges / icon rings so
// every status colour still derives from the active theme (no hardcoded colour).
const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;

export function ExtensionCard({
    ext,
    onOpen,
    onToggle,
    onInstall,
    toggling,
    installing,
    locked,
}: {
    ext: Extension;
    onOpen: () => void;
    onToggle: () => void;
    onInstall: () => void;
    toggling: boolean;
    installing: boolean;
    locked: boolean;
}) {
    const Icon = resolveExtensionIcon(ext.icon);
    const tone = extensionTone(ext);
    const accent = toneVar(tone);
    const showAccentEdge = tone === 'enabled' || tone === 'update';

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            style={{ borderRadius: 'var(--radius-card)' }}
            className={cn(
                'group relative flex cursor-pointer flex-col overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 text-left',
                'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-lg hover:shadow-black/20',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50',
            )}
        >
            {/* tone accent edge for live / updatable extensions */}
            {showAccentEdge && (
                <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: accent }} aria-hidden />
            )}

            <div className="flex items-start gap-3 p-4">
                <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
                    style={{ background: tint(accent, 12), borderColor: tint(accent, 30), color: accent }}
                >
                    <Icon className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">{ext.name}</h3>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                            v{ext.version}
                        </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                        {m['extensions.card.by']({ author: ext.author })}
                    </p>
                </div>

                <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{ background: tint(accent, 12), borderColor: tint(accent, 30), color: accent }}
                >
                    {tone === 'update' && <ArrowUpCircle className="h-3 w-3" />}
                    {tone === 'core' && <BadgeCheck className="h-3 w-3" />}
                    {td(`extensions.${toneLabelKey(tone)}`)}
                </span>
            </div>

            <p className="line-clamp-2 px-4 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                {ext.description}
            </p>

            <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3">
                <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-[var(--color-ink-faint)]">
                    {ext.source.official && <BadgeCheck className="h-3.5 w-3.5 text-[var(--brand)]" />}
                    <span className="truncate">{ext.source.label}</span>
                </span>

                <div className="flex shrink-0 items-center gap-2" onClick={e => e.stopPropagation()}>
                    {ext.installable ? (
                        <button
                            type="button"
                            onClick={onInstall}
                            disabled={locked || installing}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50"
                        >
                            {installing ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                            {m['extensions.card.install']()}
                        </button>
                    ) : (
                        <>
                            <Switch
                                checked={ext.enabled}
                                disabled={toggling || locked}
                                onChange={onToggle}
                                label={ext.enabled ? m['extensions.card.disabled']() : m['extensions.card.enabled']()}
                            />
                            <button
                                type="button"
                                onClick={onOpen}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                            >
                                <Settings2 className="h-3.5 w-3.5" />
                                {m['extensions.card.manage']()}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
