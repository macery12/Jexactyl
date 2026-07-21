import { m } from '@/i18n';
import { useMemo } from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { useBilling } from '@/state/billing';
import { parseMultiplierSteps, estimatePlanPrice } from '@/api/serverBilling';
import { cn } from '@/lib/cn';

export interface CycleDraft {
    id?: number;
    days: number;
    isEnabled: boolean;
}

/** Cycle lengths worth offering out of the box, so nobody types 365 by hand. */
const COMMON_CYCLES = [7, 30, 90, 180, 365];

/**
 * Billing cycle editor with a live price readout.
 *
 * The product's price is quoted for the panel's DEFAULT cycle length, not for
 * every cycle: the server divides it into a per-day rate and rescales it by the
 * multiplier steps configured under Billing → Rules. So a $5 product can bill
 * $13.50 on a 90-day cycle, and previously nothing on this page said so.
 *
 * We mirror that formula client-side via estimatePlanPrice (the same helper the
 * customer-facing plan switcher uses) so the numbers update as you type, rather
 * than only after a save-and-reload round trip.
 */
export function CycleEditor({
    cycles,
    onChange,
    price,
}: {
    cycles: CycleDraft[];
    onChange: (next: CycleDraft[]) => void;
    /** The product's single price, quoted for the panel's default cycle. */
    price: number;
}) {
    const { billing, money } = useBilling();
    const renewal = ((billing as Record<string, any>).renewal ?? {}) as Record<string, unknown>;

    const defaultDays = Number(renewal.default_billing_days ?? 30) || 30;
    const steps = useMemo(() => parseMultiplierSteps(renewal.multiplier_steps), [renewal.multiplier_steps]);

    const patch = (i: number, next: Partial<CycleDraft>) =>
        onChange(cycles.map((c, ci) => (ci === i ? { ...c, ...next } : c)));

    const addCycle = (days: number) => {
        if (cycles.some(c => c.days === days)) return;
        onChange([...cycles, { days, isEnabled: true }].sort((a, b) => a.days - b.days));
    };

    const unusedCommon = COMMON_CYCLES.filter(d => !cycles.some(c => c.days === d));

    return (
        <div className="flex flex-col gap-4">
            {cycles.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">
                    {m['admin.billing.cycles.emptyHint']({ days: defaultDays })}
                </p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-left">
                                <th className="px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)]">
                                    {m['admin.billing.cycles.length']()}
                                </th>
                                <th className="px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)]">
                                    {m['admin.billing.cycles.customerPays']()}
                                </th>
                                <th className="hidden px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)] sm:table-cell">
                                    {m['admin.billing.cycles.adjustment']()}
                                </th>
                                <th className="px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)]">
                                    {m['admin.billing.cycles.enabled']()}
                                </th>
                                <th className="w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {cycles.map((c, i) => {
                                const valid = c.days > 0 && Number.isFinite(c.days);
                                const est = valid
                                    ? estimatePlanPrice({ price }, c.days, defaultDays, steps)
                                    : null;
                                const isDefault = c.days === defaultDays;

                                return (
                                    <tr
                                        key={c.id ?? `new-${i}`}
                                        className={cn(
                                            'border-b border-[var(--color-border)] last:border-0',
                                            !c.isEnabled && 'opacity-50',
                                        )}
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    max="365"
                                                    value={Number.isFinite(c.days) ? c.days : ''}
                                                    onChange={e => patch(i, { days: Number(e.target.value) })}
                                                    className="h-9 w-20 px-2"
                                                    aria-label={m['admin.billing.cycles.days']()}
                                                />
                                                <span className="text-xs text-[var(--color-ink-muted)]">
                                                    {m['admin.billing.cycles.days']()}
                                                </span>
                                                {isDefault && (
                                                    <span
                                                        title={m['admin.billing.cycles.defaultHint']()}
                                                        className="flex items-center gap-1 rounded-md bg-[var(--brand)]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-bright)]"
                                                    >
                                                        <Star className="h-3 w-3 fill-current" />
                                                        {m['admin.billing.cycles.default']()}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 font-mono tabular-nums text-[var(--color-ink)]">
                                            {est ? money(est.price) : '—'}
                                        </td>
                                        <td className="hidden px-3 py-2 sm:table-cell">
                                            {est && <Adjustment discount={est.discount} />}
                                        </td>
                                        <td className="px-3 py-2">
                                            <Switch
                                                checked={c.isEnabled}
                                                onChange={v => patch(i, { isEnabled: v })}
                                                label={m['admin.billing.cycles.enabled']()}
                                            />
                                        </td>
                                        <td className="px-1 py-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label={m['admin.billing.cycles.remove']()}
                                                onClick={() => onChange(cycles.filter((_, ci) => ci !== i))}
                                            >
                                                <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {unusedCommon.map(d => (
                    <Button key={d} type="button" variant="outline" size="sm" onClick={() => addCycle(d)}>
                        <Plus className="h-3.5 w-3.5" /> {m['admin.billing.cycles.nDays']({ days: d })}
                    </Button>
                ))}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => addCycle(Math.max(1, ...cycles.map(c => c.days)) + 1)}
                >
                    <Plus className="h-3.5 w-3.5" /> {m['admin.billing.cycles.addCustom']()}
                </Button>
            </div>

            <p className="text-xs text-[var(--color-ink-faint)]">
                {m['admin.billing.cycles.formulaHint']({ days: defaultDays })}
            </p>
        </div>
    );
}

/** Renders a cycle's premium/discount relative to straight per-day pricing. */
function Adjustment({ discount }: { discount: number }) {
    const rounded = Math.round(discount);
    if (rounded === 0) {
        return <span className="text-xs text-[var(--color-ink-faint)]">{m['admin.billing.cycles.standard']()}</span>;
    }
    const saving = rounded > 0;
    return (
        <span
            className={cn(
                'rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
                saving
                    ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                    : 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
            )}
        >
            {saving
                ? m['admin.billing.cycles.savePct']({ pct: rounded })
                : m['admin.billing.cycles.premiumPct']({ pct: Math.abs(rounded) })}
        </span>
    );
}
