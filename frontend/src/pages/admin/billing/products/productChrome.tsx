import { m } from '@/i18n/messages';
import { Infinity as InfinityIcon, Cpu, MemoryStick, HardDrive, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { useBilling } from '@/state/billing';
import { formatMib } from '@/lib/format';
import { cn } from '@/lib/cn';

// Building blocks shared by the product editor and the category page.
//
// The recurring problem these solve: every limit is stored as a bare integer
// where 0 silently means "unlimited". The old editor rendered that as a plain
// number box, so an admin typing 0 had no idea whether they'd just given the
// plan nothing or given it everything. Each control below states which one it is.

/**
 * A resource limit input that names its unit and spells out what 0 means.
 *
 * `unlimitable` marks the limits where the daemon reads 0 as "no cap" (CPU,
 * memory, disk). For countable features 0 genuinely means none, so those get
 * the "none" wording instead.
 */
export function LimitField({
    label,
    icon: Icon,
    unit,
    hint,
    value,
    onChange,
    unlimitable = false,
    presets,
}: {
    label: string;
    icon: LucideIcon;
    unit?: string;
    hint: string;
    value: number;
    onChange: (next: number) => void;
    unlimitable?: boolean;
    presets?: number[];
}) {
    const isZero = value === 0;

    return (
        <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-muted)]">
                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                {label}
                {unit && <code className="font-mono text-[10px] text-[var(--color-ink-faint)]">{unit}</code>}
            </label>

            <div className="relative">
                <Input
                    type="number"
                    min="0"
                    value={Number.isFinite(value) ? value : 0}
                    onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
                    className={cn(isZero && 'pr-28')}
                />
                {isZero && (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-xs font-medium text-[var(--color-ink-faint)]">
                        {unlimitable ? (
                            <>
                                <InfinityIcon className="h-3.5 w-3.5" /> {m['admin.billing.products.unlimited']()}
                            </>
                        ) : (
                            m['admin.billing.products.none']()
                        )}
                    </span>
                )}
            </div>

            {presets && presets.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {presets.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => onChange(p)}
                            title={p === 0 && unlimitable ? m['admin.billing.products.unlimited']() : undefined}
                            className={cn(
                                'rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums transition-colors',
                                value === p
                                    ? 'border-[var(--brand)]/40 bg-[var(--brand)]/10 text-[var(--color-ink)]'
                                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                            )}
                        >
                            {p === 0 ? (unlimitable ? '∞' : '0') : p >= 1024 && unit === 'MiB' ? `${p / 1024}G` : p}
                        </button>
                    ))}
                </div>
            )}

            <span className="text-xs text-[var(--color-ink-faint)]">{hint}</span>
        </div>
    );
}

/**
 * A compact mirror of the storefront plan card (see landing/sections/Pricing.tsx),
 * fed live from the editor's form values.
 *
 * The editor is a wall of integers; this is the only place that says what those
 * integers add up to from the customer's side. It deliberately renders the same
 * three stats the real card leads with, so "20480" reads back as "20 GB" before
 * anyone publishes it.
 */
export function ProductPreview({
    name,
    price,
    description,
    cpu,
    memory,
    disk,
}: {
    name: string;
    price: number;
    description: string;
    cpu: number;
    memory: number;
    disk: number;
}) {
    const { money } = useBilling();

    const stats: [LucideIcon, string][] = [
        [Cpu, cpu === 0 ? m['admin.billing.products.unlimited']() : `${cpu}%`],
        [MemoryStick, memory === 0 ? m['admin.billing.products.unlimited']() : formatMib(memory)],
        [HardDrive, disk === 0 ? m['admin.billing.products.unlimited']() : formatMib(disk)],
    ];

    return (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/60 p-4">
            <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                {name.trim() || m['admin.billing.products.untitled']()}
            </p>
            {description.trim() && (
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{description.trim()}</p>
            )}
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-[var(--brand-bright)]">
                {price === 0 ? m['admin.billing.products.free']() : money(price)}
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 text-xs text-[var(--color-ink-muted)]">
                {stats.map(([Icon, label], i) => (
                    <li key={i} className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--brand-bright)]" />
                        <span className="font-mono tabular-nums">{label}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** Small pill used for visible/hidden and other binary catalog state. */
export function StatePill({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                on
                    ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]',
            )}
        >
            <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-ink-faint)]')} />
            {on ? onLabel : offLabel}
        </span>
    );
}
