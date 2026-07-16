import { m } from '@/i18n';
import { useState, type ReactNode } from 'react';
import { Check, Cpu, HardDrive, MemoryStick, Database, Network, Archive, Globe, Tag, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useBilling } from '@/state/billing';
import type { ProductLimits, ProductCycle, VariableFieldModel } from '@/api/accountBilling';
import type { CheckoutController } from './checkout';

const gb = (mib: number) => `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GB`;

// ---- Selectable choice card (location / software) ---------------------------

export function ChoiceCard({
    selected,
    onSelect,
    title,
    subtitle,
    badge,
    aside,
    icon,
}: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    subtitle?: string;
    badge?: string;
    aside?: ReactNode;
    icon?: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={cn(
                'group relative flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all',
                selected
                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 ring-1 ring-[var(--brand)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 hover:border-[var(--color-ink-faint)]',
            )}
        >
            {icon && <div className="text-2xl leading-none">{icon}</div>}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-[var(--color-ink)]">{title}</p>
                    {badge && (
                        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                            {badge}
                        </span>
                    )}
                </div>
                {subtitle && <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">{subtitle}</p>}
            </div>
            {aside}
            <span
                className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                    selected
                        ? 'border-transparent bg-[var(--brand)] text-[var(--color-brand-ink)]'
                        : 'border-[var(--color-border-strong)] text-transparent',
                )}
            >
                <Check className="h-3.5 w-3.5" />
            </span>
        </button>
    );
}

// ---- Billing cycle option ---------------------------------------------------

export function CycleCard({
    cycle,
    selected,
    onSelect,
}: {
    cycle: ProductCycle;
    selected: boolean;
    onSelect: () => void;
}) {
    const { money } = useBilling();
    const perMonth = cycle.days > 0 ? cycle.price / (cycle.days / 30) : cycle.price;
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={cn(
                'relative flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all',
                selected
                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 ring-1 ring-[var(--brand)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 hover:border-[var(--color-ink-faint)]',
            )}
        >
            <div>
                <div className="flex items-center gap-2">
                    <p className="font-semibold text-[var(--color-ink)]">
                        {cycle.label ?? `${cycle.days} days`}
                    </p>
                    {cycle.discountPercent > 0 && (
                        <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
                            {m['billing.cycle.save']({ percent: cycle.discountPercent })}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                    {m['billing.cycle.perMonthBilled']({ price: money(perMonth), days: cycle.days })}
                </p>
            </div>
            <div className="text-right">
                <p className="font-semibold text-[var(--color-ink)]">{money(cycle.price)}</p>
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">{m['billing.cycle.perTerm']()}</p>
            </div>
        </button>
    );
}

// ---- Egg variable field -----------------------------------------------------

export function VariableField({
    field,
    value,
    onChange,
}: {
    field: VariableFieldModel;
    value: string;
    onChange: (next: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-ink)]">{field.label}</label>
            {field.description && <p className="text-xs text-[var(--color-ink-muted)]">{field.description}</p>}
            {field.kind === 'select' ? (
                <div className="flex flex-wrap gap-2 pt-1">
                    {field.options?.map(opt => (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => onChange(opt)}
                            className={cn(
                                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                                value === opt
                                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--color-ink)]'
                                    : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                            )}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            ) : (
                <Input
                    type={field.kind === 'number' ? 'number' : 'text'}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="mt-1"
                />
            )}
        </div>
    );
}

// ---- Spec chips (product limits) -------------------------------------------

export function SpecChips({ limits }: { limits: ProductLimits }) {
    const specs = [
        { icon: Cpu, label: m['billing.specs.cpu']({ value: limits.cpu }) },
        { icon: MemoryStick, label: m['billing.specs.ram']({ value: gb(limits.memory) }) },
        { icon: HardDrive, label: m['billing.specs.ssd']({ value: gb(limits.disk) }) },
        ...(limits.backup ? [{ icon: Archive, label: m['billing.specs.backups']({ count: limits.backup }) }] : []),
        ...(limits.database ? [{ icon: Database, label: m['billing.specs.databases']({ count: limits.database }) }] : []),
        { icon: Network, label: m['billing.specs.ports']({ count: limits.allocation }) },
        ...(limits.subdomain != null ? [{ icon: Globe, label: m['billing.specs.subdomains']({ count: limits.subdomain }) }] : []),
    ];
    return (
        <div className="flex flex-wrap gap-2">
            {specs.map(s => (
                <span
                    key={s.label}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]"
                >
                    <s.icon className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" /> {s.label}
                </span>
            ))}
        </div>
    );
}

// ---- Coupon input -----------------------------------------------------------

function CouponBox({ checkout }: { checkout: CheckoutController }) {
    const [code, setCode] = useState('');
    const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

    if (checkout.couponData) {
        return (
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                    <Tag className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                    {checkout.couponData.coupon.code}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        checkout.clearCoupon();
                        setFeedback(null);
                    }}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <div className="flex gap-2">
                <Input
                    value={code}
                    placeholder={m['billing.coupon.placeholder']()}
                    className="h-10"
                    onChange={e => setCode(e.target.value)}
                />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0"
                    disabled={checkout.couponBusy}
                    onClick={async () => setFeedback(await checkout.applyCoupon(code))}
                >
                    {checkout.couponBusy ? <Spinner className="h-4 w-4" /> : m['billing.coupon.apply']()}
                </Button>
            </div>
            {feedback && !feedback.ok && <p className="text-xs text-[var(--color-danger)]">{feedback.message}</p>}
        </div>
    );
}

// ---- Live summary "cart" ----------------------------------------------------

export function SummaryCart({
    checkout,
    cta,
    showCoupon = true,
}: {
    checkout: CheckoutController;
    cta?: ReactNode;
    showCoupon?: boolean;
}) {
    const { money } = useBilling();
    const { product } = checkout;
    if (!product) return null;

    const node = checkout.nodes.find(n => n.id === checkout.nodeId);
    const egg = checkout.eggs.find(e => e.id === checkout.eggId);
    const couponSavings = checkout.couponData?.discount ?? 0;

    const Row = ({ label, value }: { label: string; value: string }) => (
        <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-ink-muted)]">{label}</span>
            <span className="font-medium text-[var(--color-ink)]">{value}</span>
        </div>
    );

    return (
        <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/80 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                {m['billing.summary.yourBuild']()}
            </p>

            <div className="mt-3 rounded-xl bg-[var(--color-surface-2)]/60 p-3">
                <p className="font-semibold text-[var(--color-ink)]">{product.name}</p>
                {product.description && (
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{product.description}</p>
                )}
                <div className="mt-3">
                    <SpecChips limits={product.limits} />
                </div>
            </div>

            <div className="mt-4 space-y-2">
                <Row label={m['billing.summary.location']()} value={node?.name ?? '—'} />
                <Row label={m['billing.summary.software']()} value={egg?.name ?? '—'} />
                <Row label={m['billing.summary.serverName']()} value={checkout.serverName.trim() || m['billing.summary.notSet']()} />
                <Row
                    label={m['billing.summary.billingCycle']()}
                    value={checkout.selectedCycle?.label ?? `${checkout.cycleDays} days`}
                />
            </div>

            <div className="my-4 h-px bg-[var(--color-border)]" />

            <div className="space-y-2">
                <Row label={m['billing.summary.subtotal']()} value={money(checkout.basePrice)} />
                {couponSavings > 0 && (
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--color-accent)]">
                            {m['billing.summary.coupon']({ code: checkout.couponData?.coupon.code ?? '' })}
                        </span>
                        <span className="font-medium text-[var(--color-accent)]">−{money(couponSavings)}</span>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-end justify-between">
                <span className="text-sm text-[var(--color-ink-muted)]">{m['billing.summary.totalDue']()}</span>
                <span className="text-2xl font-bold text-[var(--color-ink)]">
                    {checkout.isFree ? m['billing.summary.free']() : money(checkout.total)}
                </span>
            </div>

            {showCoupon && (
                <div className="mt-4">
                    <CouponBox checkout={checkout} />
                </div>
            )}

            {cta && <div className="mt-4">{cta}</div>}
        </div>
    );
}
