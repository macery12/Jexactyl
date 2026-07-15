import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeftRight, AlertTriangle } from 'lucide-react';
import { m, td } from '@/i18n';
import { Panel } from '@/components/ui/Panel';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useBilling } from '@/state/billing';
import { useFlashes } from '@/state/flashes';
import { getProductBillingCycles, type StoreProduct } from '@/api/accountBilling';
import {
    getAvailablePlans,
    validatePlanChange,
    changePlan,
    estimatePlanPrice,
    parseMultiplierSteps,
    type PlanChangeValidation,
} from '@/api/serverBilling';
import type { RenewalSettings } from './billingModel';
import { Notice, CyclePicker } from './parts';

// Upgrade or downgrade the plan backing this server. A downgrade that would
// strand existing usage (more databases than the target allows, say) is
// rejected by the backend validator before the confirm dialog opens.
export function ChangePlanPanel({ currency }: { currency: string }) {
    const server = useServer();
    const { money } = useBilling();
    const push = useFlashes(s => s.push);
    const renewal = (useFlags(s => s.everest?.billing?.renewal) as RenewalSettings | undefined) ?? {};

    const [selected, setSelected] = useState<StoreProduct | null>(null);
    const [validation, setValidation] = useState<PlanChangeValidation | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [cycleDays, setCycleDays] = useState<number | null>(null);

    const defaultBillingDays = server.billingDays || renewal.default_billing_days || 30;
    const steps = parseMultiplierSteps(renewal.multiplier_steps);

    const plansQ = useQuery({
        queryKey: ['server', server.id, 'billing', 'plans'],
        queryFn: () => getAvailablePlans(server.uuid),
        enabled: !!server.billingProductId,
    });

    // Only fetched once a plan passes validation — the confirm dialog prices
    // against real cycles rather than the multiplier estimate.
    const cyclesQ = useQuery({
        queryKey: ['store', 'cycles', selected?.id],
        queryFn: () => getProductBillingCycles(selected!.id),
        enabled: !!selected && !!validation?.valid,
    });

    const pick = useMutation({
        mutationFn: async (plan: StoreProduct) => ({ plan, result: await validatePlanChange(server.uuid, plan.id) }),
        onSuccess: ({ plan, result }) => {
            setSelected(plan);
            setValidation(result);
            if (result.valid) {
                setCycleDays(null);
                setConfirming(true);
            }
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const apply = useMutation({
        mutationFn: () => changePlan(server.uuid, selected!.id, cycleDays ?? defaultBillingDays),
        // New limits land on the server record, the socket, and the sidebar at
        // once — V1 reloads here and so do we.
        onSuccess: () => window.location.reload(),
        onError: () => {
            push({ type: 'error', message: m['server.billing.planChangeError']() });
            setConfirming(false);
        },
    });

    // Cycles arrive after validation; default to the product's own default.
    const cycles = cyclesQ.data ?? [];
    const effectiveCycle = cycleDays ?? cycles.find(c => c.isDefault)?.days ?? cycles[0]?.days ?? null;

    if (!server.billingProductId) return null;

    if (plansQ.isLoading) {
        return (
            <Panel title={m['server.billing.plans']()} icon={ArrowLeftRight}>
                <div className="flex justify-center py-6">
                    <Spinner className="h-6 w-6" />
                </div>
            </Panel>
        );
    }

    const plans = plansQ.data ?? [];
    if (plans.length === 0) return null;

    const selectedCycle = cycles.find(c => c.days === effectiveCycle);
    const estimate = selected ? estimatePlanPrice(selected, effectiveCycle ?? defaultBillingDays, defaultBillingDays, steps) : null;
    const confirmPrice = selectedCycle?.price ?? estimate?.price ?? 0;
    const confirmDiscount = selectedCycle?.discountPercent ?? estimate?.discount ?? 0;

    return (
        <>
            <Panel title={m['server.billing.plans']()} icon={ArrowLeftRight}>
                <div className="space-y-2">
                    <p className="text-xs text-[var(--color-ink-muted)]">{m['server.billing.plansHint']()}</p>

                    {plans.map(plan => {
                        const { price, discount } = estimatePlanPrice(plan, defaultBillingDays, defaultBillingDays, steps);
                        const failed = selected?.id === plan.id && validation && !validation.valid;

                        return (
                            <div key={plan.id}>
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline gap-2">
                                            <h3 className="truncate text-sm font-medium text-[var(--color-ink)]">
                                                {plan.name}
                                            </h3>
                                            <span className="font-mono text-xs tabular-nums text-[var(--color-ink-muted)]">
                                                {money(price)}
                                            </span>
                                            {discount !== 0 && (
                                                <span
                                                    className={`text-[11px] ${
                                                        discount > 0
                                                            ? 'text-[var(--color-accent)]'
                                                            : 'text-[var(--color-warning)]'
                                                    }`}
                                                >
                                                    {discount > 0
                                                        ? m['server.billing.discountShort']({ percent: Math.abs(discount).toFixed(1) })
                                                        : m['server.billing.premiumShort']({ percent: Math.abs(discount).toFixed(1) })}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-0.5 truncate text-[11px] text-[var(--color-ink-faint)]">
                                            {m['server.billing.planSpecs']({
                                                cpu: plan.limits.cpu,
                                                memory: plan.limits.memory,
                                                disk: plan.limits.disk,
                                                databases: plan.limits.database,
                                                backups: plan.limits.backup,
                                            })}
                                            {' · '}
                                            {plan.limits.subdomain == null
                                                ? m['server.billing.unlimitedSubdomains']()
                                                : m['server.billing.subdomains']({ count: plan.limits.subdomain })}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={pick.isPending || apply.isPending}
                                        onClick={() => pick.mutate(plan)}
                                    >
                                        {pick.isPending && pick.variables?.id === plan.id ? (
                                            <Spinner className="h-4 w-4" />
                                        ) : (
                                            m['server.billing.select']()
                                        )}
                                    </Button>
                                </div>

                                {failed && (
                                    <div className="mt-1.5">
                                        <Notice tone="danger" icon={AlertTriangle}>
                                            <p className="font-medium">{m['server.billing.downgradeBlocked']()}</p>
                                            <ul className="mt-1 space-y-0.5">
                                                {Object.entries(validation.violations ?? {}).map(([resource, v]) => (
                                                    <li key={resource} className="font-mono text-[11px] tabular-nums">
                                                        {m['server.billing.violation']({
                                                            resource: td(`server.billing.resource.${resource}`, resource),
                                                            current: v.current,
                                                            limit: v.limit,
                                                            unit: v.unit,
                                                        })}
                                                    </li>
                                                ))}
                                            </ul>
                                        </Notice>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </Panel>

            <Modal
                open={confirming}
                onClose={() => setConfirming(false)}
                title={m['server.billing.confirmPlanTitle']()}
                description={selected ? m['server.billing.confirmPlanBody']({ name: selected.name }) : undefined}
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={apply.isPending}>
                            {m['common.actions.cancel']()}
                        </Button>
                        <Button
                            size="sm"
                            disabled={apply.isPending || cyclesQ.isLoading}
                            onClick={() => apply.mutate()}
                        >
                            {apply.isPending && <Spinner className="h-4 w-4" />}
                            {m['common.actions.confirm']()}
                        </Button>
                    </>
                }
            >
                {selected && (
                    <div className="space-y-4">
                        {cyclesQ.isLoading ? (
                            <div className="flex justify-center py-4">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : (
                            cycles.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                                        {m['billing.payment.billingCycle']()}
                                    </p>
                                    <CyclePicker
                                        cycles={cycles}
                                        selected={effectiveCycle}
                                        onSelect={setCycleDays}
                                        disabled={apply.isPending}
                                    />
                                </div>
                            )
                        )}

                        <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                                {m['server.billing.newResources']()}
                            </p>
                            <dl className="space-y-1 text-sm">
                                <ResourceRow label={m['common.metrics.cpu']()} value={`${selected.limits.cpu}%`} />
                                <ResourceRow label={m['common.metrics.memory']()} value={`${selected.limits.memory} MB`} />
                                <ResourceRow label={m['common.metrics.disk']()} value={`${selected.limits.disk} MB`} />
                                <ResourceRow label={m['server.billing.databases']()} value={String(selected.limits.database)} />
                                <ResourceRow label={m['server.billing.backups']()} value={String(selected.limits.backup)} />
                            </dl>
                        </div>

                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                                {m['server.billing.price']()}
                            </p>
                            <div className="flex items-baseline gap-2">
                                <span className="font-mono text-lg font-semibold tabular-nums text-[var(--color-ink)]">
                                    {money(confirmPrice)}
                                </span>
                                <span className="text-xs text-[var(--color-ink-faint)]">{currency.toUpperCase()}</span>
                                {confirmDiscount !== 0 && (
                                    <span
                                        className={`text-[11px] font-medium ${
                                            confirmDiscount > 0
                                                ? 'text-[var(--color-accent)]'
                                                : 'text-[var(--color-warning)]'
                                        }`}
                                    >
                                        {confirmDiscount > 0
                                            ? m['server.billing.discountShort']({ percent: Math.abs(confirmDiscount).toFixed(1) })
                                            : m['server.billing.premiumShort']({ percent: Math.abs(confirmDiscount).toFixed(1) })}
                                    </span>
                                )}
                            </div>
                            {effectiveCycle && (
                                <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                                    {m['server.billing.billedEvery']({ days: effectiveCycle })}
                                </p>
                            )}
                        </div>

                        <Notice tone="info">{m['server.billing.planChangeNotice']()}</Notice>
                    </div>
                )}
            </Modal>
        </>
    );
}

function ResourceRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between">
            <dt className="text-[var(--color-ink-muted)]">{label}</dt>
            <dd className="font-mono tabular-nums text-[var(--color-ink)]">{value}</dd>
        </div>
    );
}
