import { useState, type ReactNode } from 'react';
import { Info, Tag, X, type LucideIcon } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useBilling } from '@/state/billing';
import { validateCoupon, type ProductCycle, type ValidateCouponResponse } from '@/api/accountBilling';

// ---- Notice -----------------------------------------------------------------

type Tone = 'info' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
    info: 'border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--color-ink)]',
    warning: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-ink)]',
    danger: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-ink)]',
};

const TONE_ICON: Record<Tone, string> = {
    info: 'text-[var(--brand)]',
    warning: 'text-[var(--color-warning)]',
    danger: 'text-[var(--color-danger)]',
};

/** Inline alert — the V2 stand-in for V1's <Alert type>. */
export function Notice({
    tone = 'info',
    icon: Icon = Info,
    children,
}: {
    tone?: Tone;
    icon?: LucideIcon;
    children: ReactNode;
}) {
    return (
        <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${TONES[tone]}`}>
            <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${TONE_ICON[tone]}`} />
            <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
        </div>
    );
}

// ---- Billing cycle picker ---------------------------------------------------

/**
 * Radio list of billing cycles with per-cycle pricing. Used both for choosing
 * the renewal length and for picking the cycle when switching plan.
 */
export function CyclePicker({
    cycles,
    selected,
    onSelect,
    disabled,
}: {
    cycles: ProductCycle[];
    selected: number | null;
    onSelect: (days: number) => void;
    disabled?: boolean;
}) {
    const { money } = useBilling();

    return (
        <div className="space-y-1.5">
            {cycles.map(cycle => {
                const active = selected === cycle.days;

                return (
                    <button
                        key={cycle.days}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelect(cycle.days)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                            active
                                ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                                : 'border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]'
                        }`}
                    >
                        <span className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--color-ink)]">
                                {m['server.billing.cycleDays']({ days: cycle.days })}
                            </span>
                            {cycle.isDefault && (
                                <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand)]">
                                    {m['server.billing.cycleDefault']()}
                                </span>
                            )}
                        </span>
                        <span className="flex items-baseline gap-1.5">
                            <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">
                                {money(cycle.price)}
                            </span>
                            {cycle.discountPercent !== 0 && (
                                <span
                                    className={`text-[11px] ${
                                        cycle.discountPercent > 0
                                            ? 'text-[var(--color-accent)]'
                                            : 'text-[var(--color-warning)]'
                                    }`}
                                >
                                    {cycle.discountPercent > 0 ? '-' : '+'}
                                    {Math.abs(cycle.discountPercent).toFixed(0)}%
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// ---- Coupon field -----------------------------------------------------------

/**
 * Coupon entry for renewals. Validates against the `ren` order type so
 * new-order-only coupons are rejected server-side, same as V1.
 */
export function CouponField({
    subtotal,
    applied,
    onChange,
    disabled,
}: {
    subtotal: number;
    applied: ValidateCouponResponse | null;
    onChange: (data: ValidateCouponResponse | null) => void;
    disabled?: boolean;
}) {
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (applied) {
        return (
            <div className="flex items-center justify-between rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                    <Tag className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                    {applied.coupon.code}
                </span>
                <button
                    type="button"
                    aria-label={m['common.actions.remove']()}
                    onClick={() => {
                        onChange(null);
                        setError(null);
                    }}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        );
    }

    const apply = async () => {
        if (!code.trim()) {
            setError(m['billing.coupon.empty']());
            return;
        }
        setBusy(true);
        setError(null);
        try {
            onChange(await validateCoupon(code.trim(), subtotal, 'ren'));
            setCode('');
        } catch {
            setError(m['billing.coupon.invalid']());
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-1">
            <div className="flex gap-2">
                <Input
                    value={code}
                    disabled={disabled || busy}
                    placeholder={m['billing.coupon.placeholder']()}
                    className="h-9"
                    onChange={e => setCode(e.target.value)}
                />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={disabled || busy}
                    onClick={apply}
                >
                    {busy ? <Spinner className="h-4 w-4" /> : m['billing.coupon.apply']()}
                </Button>
            </div>
            {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        </div>
    );
}
