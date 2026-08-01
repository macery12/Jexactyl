import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, AlertTriangle, CalendarClock } from 'lucide-react';
import { m, td } from '@/i18n';
import { Panel } from '@/components/ui/Panel';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useBilling } from '@/state/billing';
import { useFlashes } from '@/state/flashes';
import type { StoreProduct } from '@/api/accountBilling';
import {
    cancelPendingPlanChange,
    cancelScheduledPlanChange,
    estimatePlanPrice,
    getAvailablePlans,
    getPlanChangeState,
    parseMultiplierSteps,
    schedulePlanChange,
    validatePlanChange,
    type PlanChangeValidation,
} from '@/api/serverBilling';
import type { RenewalSettings } from './billingModel';
import { Notice } from './parts';

// A plan change never changes the server's billing cycle. More-expensive plans
// are paid for now using a server-authoritative prorated quote; equal or cheaper
// plans are scheduled for the existing renewal date without a refund.
export function ChangePlanPanel({ currency }: { currency: string }) {
    const server = useServer();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { money } = useBilling();
    const push = useFlashes(s => s.push);
    const renewal = (useFlags(s => s.everest?.billing?.renewal) as RenewalSettings | undefined) ?? {};

    const [selected, setSelected] = useState<StoreProduct | null>(null);
    const [validation, setValidation] = useState<PlanChangeValidation | null>(null);
    const [confirming, setConfirming] = useState(false);

    const defaultBillingDays = server.billingDays || renewal.default_billing_days || 30;
    const steps = parseMultiplierSteps(renewal.multiplier_steps);

    const plansQ = useQuery({
        queryKey: ['server', server.id, 'billing', 'plans'],
        queryFn: () => getAvailablePlans(server.uuid),
        enabled: !!server.billingProductId,
    });
    const scheduledQ = useQuery({
        queryKey: ['server', server.id, 'billing', 'scheduled-plan-change'],
        queryFn: () => getPlanChangeState(server.uuid),
        enabled: !!server.billingProductId,
    });

    const pick = useMutation({
        mutationFn: async (plan: StoreProduct) => ({ plan, result: await validatePlanChange(server.uuid, plan.id) }),
        onSuccess: ({ plan, result }) => {
            setSelected(plan);
            setValidation(result);
            if (result.valid) setConfirming(true);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const schedule = useMutation({
        mutationFn: () => schedulePlanChange(server.uuid, selected!.id),
        onSuccess: async () => {
            setConfirming(false);
            setSelected(null);
            setValidation(null);
            await queryClient.invalidateQueries({
                queryKey: ['server', server.id, 'billing', 'scheduled-plan-change'],
            });
            push({ type: 'success', message: m['server.billing.planScheduledSuccess']() });
        },
        onError: () => push({ type: 'error', message: m['server.billing.planScheduleError']() }),
    });

    const cancelSchedule = useMutation({
        mutationFn: () => cancelScheduledPlanChange(server.uuid),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['server', server.id, 'billing', 'scheduled-plan-change'],
            });
            push({ type: 'success', message: m['server.billing.planScheduleCancelled']() });
        },
        onError: () => push({ type: 'error', message: m['server.billing.planScheduleCancelError']() }),
    });

    const cancelPending = useMutation({
        mutationFn: () => cancelPendingPlanChange(server.uuid),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['server', server.id, 'billing', 'scheduled-plan-change'],
            });
            push({ type: 'success', message: m['server.billing.pendingPlanCancelled']() });
        },
        onError: () => push({ type: 'error', message: m['server.billing.pendingPlanCancelError']() }),
    });

    if (!server.billingProductId) return null;

    if (plansQ.isLoading || scheduledQ.isLoading) {
        return (
            <Panel title={m['server.billing.plans']()} icon={ArrowLeftRight}>
                <div className="flex justify-center py-6">
                    <Spinner className="h-6 w-6" />
                </div>
            </Panel>
        );
    }

    const scheduled = scheduledQ.data?.scheduled_change;
    const pending = scheduledQ.data?.pending_change;
    const plans = plansQ.data ?? [];
    if (plans.length === 0 && !scheduled && !pending) return null;

    const quote = validation?.quote;
    const busy = pick.isPending || schedule.isPending || cancelSchedule.isPending || cancelPending.isPending;

    const continueChange = () => {
        if (!selected || !validation) return;
        if (validation.mode === 'scheduled') {
            schedule.mutate();
            return;
        }

        const params = new URLSearchParams({
            product: String(selected.id),
            plan_change: 'true',
            server: server.id,
            server_id: String(server.internalId),
            checkout_nonce: crypto.randomUUID(),
        });
        navigate(`/checkout/payment?${params.toString()}`);
    };

    return (
        <>
            <Panel title={m['server.billing.plans']()} icon={ArrowLeftRight}>
                <div className="space-y-3">
                    <p className="text-xs text-[var(--color-ink-muted)]">{m['server.billing.plansHint']()}</p>

                    {scheduled && (
                        <Notice tone={scheduled.last_error ? 'warning' : 'info'} icon={scheduled.last_error ? AlertTriangle : CalendarClock}>
                            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="font-medium">
                                        {scheduled.last_error
                                            ? m['server.billing.scheduledPlanRetrying']({ name: scheduled.product_name })
                                            : m['server.billing.scheduledPlan']({ name: scheduled.product_name })}
                                    </p>
                                    {scheduled.last_error ? (
                                        <div className="mt-1 space-y-1 text-xs">
                                            <p className="break-words">
                                                {m['server.billing.scheduledPlanFailureReason']({
                                                    reason: scheduled.last_error,
                                                })}
                                            </p>
                                            <p>
                                                {scheduled.retry_at
                                                    ? m['server.billing.scheduledPlanRetryAt']({
                                                          date: formatDateTime(scheduled.retry_at),
                                                      })
                                                    : m['server.billing.scheduledPlanRetryPending']()}
                                            </p>
                                            <p>{m['server.billing.scheduledPlanFailureGuidance']()}</p>
                                        </div>
                                    ) : (
                                        <p className="mt-0.5 text-xs">
                                            {m['server.billing.scheduledPlanEffective']({
                                                date: formatDateTime(scheduled.effective_at),
                                            })}
                                        </p>
                                    )}
                                </div>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={cancelSchedule.isPending}
                                    onClick={() => cancelSchedule.mutate()}
                                >
                                    {cancelSchedule.isPending && <Spinner className="h-4 w-4" />}
                                    {m['server.billing.cancelScheduledPlan']()}
                                </Button>
                            </div>
                        </Notice>
                    )}

                    {pending && (
                        <Notice tone="warning" icon={AlertTriangle}>
                            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="font-medium">
                                        {m['server.billing.pendingPlanPayment']({ name: pending.product_name })}
                                    </p>
                                    <p className="mt-0.5 text-xs">{m['server.billing.pendingPlanPaymentHint']()}</p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={cancelPending.isPending}
                                    onClick={() => cancelPending.mutate()}
                                >
                                    {cancelPending.isPending && <Spinner className="h-4 w-4" />}
                                    {m['server.billing.cancelPendingPlan']()}
                                </Button>
                            </div>
                        </Notice>
                    )}

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
                                        disabled={busy || !!scheduled || !!pending}
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
                                            <div>
                                                <p className="font-medium">
                                                    {validation.message || m['server.billing.downgradeBlocked']()}
                                                </p>
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
                                            </div>
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
                title={
                    validation?.mode === 'pay_now'
                        ? m['server.billing.confirmUpgradeTitle']()
                        : m['server.billing.confirmScheduledPlanTitle']()
                }
                description={selected ? m['server.billing.confirmPlanBody']({ name: selected.name }) : undefined}
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={schedule.isPending}>
                            {m['common.actions.cancel']()}
                        </Button>
                        <Button size="sm" disabled={schedule.isPending} onClick={continueChange}>
                            {schedule.isPending && <Spinner className="h-4 w-4" />}
                            {validation?.mode === 'pay_now'
                                ? m['server.billing.continueToPayment']()
                                : m['server.billing.schedulePlan']()}
                        </Button>
                    </>
                }
            >
                {selected && validation && quote && (
                    <div className="space-y-4">
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

                        <dl className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
                            <QuoteRow
                                label={m['server.billing.currentCyclePrice']()}
                                value={money(quote.current_cycle_price)}
                            />
                            <QuoteRow
                                label={m['server.billing.targetCyclePrice']()}
                                value={money(quote.target_cycle_price)}
                            />
                            <QuoteRow
                                label={m['server.billing.renewalUnchanged']()}
                                value={formatDateTime(quote.renewal_date)}
                            />
                            <QuoteRow
                                label={m['billing.payment.billingCycle']()}
                                value={m['server.billing.cycleDays']({ days: quote.billing_days })}
                            />
                        </dl>

                        {validation.mode === 'pay_now' ? (
                            <>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                                        {m['server.billing.dueNow']()}
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
                                            {money(quote.amount_due)}
                                        </span>
                                        <span className="text-xs text-[var(--color-ink-faint)]">
                                            {(quote.currency || currency).toUpperCase()}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                                        {m['server.billing.proratedForRemaining']({
                                            time: formatRemaining(quote.remaining_seconds),
                                        })}
                                    </p>
                                </div>
                                <Notice tone="info">{m['server.billing.paidUpgradeNotice']()}</Notice>
                            </>
                        ) : (
                            <Notice tone="info">
                                {m['server.billing.scheduledChangeNotice']({
                                    date: formatDateTime(quote.renewal_date),
                                })}
                            </Notice>
                        )}
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

function QuoteRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <dt className="text-[var(--color-ink-muted)]">{label}</dt>
            <dd className="text-right font-medium text-[var(--color-ink)]">{value}</dd>
        </div>
    );
}

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatRemaining(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const days = Math.floor(safe / 86_400);
    const hours = Math.floor((safe % 86_400) / 3_600);
    return m['server.billing.remainingValue']({ days, hours });
}
