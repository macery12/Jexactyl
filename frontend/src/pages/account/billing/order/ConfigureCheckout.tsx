import { m, formatTags } from '@/i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { MapPin, Wallet, Boxes, SlidersHorizontal, Server, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import {
    getBillingProfile,
    hasCompleteBillingProfile,
    processFreeOrder,
    toFieldModel,
} from '@/api/accountBilling';
import { useCheckoutController } from './checkout';
import { saveDraft } from './draft';
import { ChoiceCard, CycleCard, SummaryCart, VariableField } from './parts';

function Section({ icon: Icon, step, title, subtitle, children }: {
    icon: LucideIcon;
    step: number;
    title: string;
    subtitle: string;
    children: ReactNode;
}) {
    return (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]">
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                        Step {step}
                    </p>
                    <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
                    <p className="text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

export default function ConfigureCheckout() {
    const { id } = useParams<'id'>();
    const productId = id ? Number(id) : 0;
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const { billing } = useBilling();

    const checkout = useCheckoutController(productId);
    const [serverNameTouched, setServerNameTouched] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Auto-suggest a server name from the egg until the user edits it.
    useEffect(() => {
        if (serverNameTouched || checkout.serverName) return;
        const egg = checkout.eggs.find(e => e.id === checkout.eggId);
        if (egg) checkout.setServerName(`${egg.name.split(' ')[0]}-${Date.now().toString().slice(-4)}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkout.eggId, checkout.eggs]);

    if (checkout.isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (checkout.isError || !checkout.product) {
        return (
            <div className="space-y-4">
                <BackLink />
                <div className="flex items-center gap-2 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
                    <AlertTriangle className="h-4 w-4" /> {firstError(checkout.error) ?? m['billing.configure.loadError']()}
                </div>
            </div>
        );
    }

    const nameMissing = checkout.serverName.trim().length === 0;
    const nodeMissing = !(checkout.nodeId > 0);
    const eggMissing = checkout.eggId === undefined;
    const canSubmit = !nameMissing && !nodeMissing && !eggMissing && checkout.legalAgreed && !submitting;

    const assertBillingAddress = async (): Promise<boolean> => {
        if (!billing.require_billing_address) return true;
        try {
            const profile = await getBillingProfile();
            if (hasCompleteBillingProfile(profile)) return true;
            push({ type: 'error', message: m['billing.configure.addressRequired']() });
            return false;
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['billing.configure.addressError']() });
            return false;
        }
    };

    const handleContinue = async () => {
        setServerNameTouched(true);
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            const ok = await assertBillingAddress();
            if (!ok) return;

            const varsPayload = Object.entries(checkout.vars).map(([key, value]) => ({ key, value }));

            if (checkout.isFree) {
                await processFreeOrder({
                    product: checkout.product!.id,
                    node: checkout.nodeId,
                    variables: varsPayload,
                    coupon_id: checkout.couponData?.coupon.id,
                    egg_id: checkout.eggId,
                    name: checkout.serverName.trim(),
                    billing_days: checkout.cycleDays,
                });
                push({ type: 'success', message: m['billing.configure.creating']() });
                navigate('/billing/success');
                return;
            }

            // Paid: hand off to the payment step with a persisted draft.
            saveDraft({
                productId: checkout.product!.id,
                nodeId: checkout.nodeId,
                cycleDays: checkout.cycleDays,
                eggId: checkout.eggId,
                vars: Object.entries(checkout.vars),
                couponId: checkout.couponData?.coupon.id,
                couponData: checkout.couponData,
                serverName: checkout.serverName.trim(),
            });
            navigate(`/checkout/payment?product=${checkout.product!.id}`);
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['billing.configure.startError']() });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <BackLink />
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">{m['billing.configure.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{checkout.product.name}</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
                <div className="space-y-6 lg:col-span-8">
                    <Section icon={MapPin} step={1} title={m['billing.configure.locationTitle']()} subtitle={m['billing.configure.locationSubtitle']()}>
                        {checkout.nodes.length === 0 ? (
                            <Empty>{m['billing.configure.noNodes']()}</Empty>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {checkout.nodes.map(node => (
                                    <ChoiceCard
                                        key={node.id}
                                        selected={checkout.nodeId === node.id}
                                        onSelect={() => checkout.setNodeId(node.id)}
                                        title={node.name}
                                        subtitle={node.priceMultiplierDescription ?? node.fqdn}
                                    />
                                ))}
                            </div>
                        )}
                    </Section>

                    <Section icon={Wallet} step={2} title={m['billing.configure.billingTitle']()} subtitle={m['billing.configure.billingSubtitle']()}>
                        {checkout.cycles.length === 0 ? (
                            <Empty>{m['billing.configure.noCycles']()}</Empty>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {checkout.cycles.map(c => (
                                    <CycleCard
                                        key={c.days}
                                        cycle={c}
                                        selected={checkout.cycleDays === c.days}
                                        onSelect={() => checkout.setCycleDays(c.days)}
                                    />
                                ))}
                            </div>
                        )}
                    </Section>

                    <Section icon={Boxes} step={3} title={m['billing.configure.softwareTitle']()} subtitle={m['billing.configure.softwareSubtitle']()}>
                        {checkout.eggs.length === 0 ? (
                            <Empty>{m['billing.configure.noEggs']()}</Empty>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {checkout.eggs.map(egg => (
                                    <ChoiceCard
                                        key={egg.id}
                                        selected={checkout.eggId === egg.id}
                                        onSelect={() => checkout.setEggId(egg.id)}
                                        title={egg.name}
                                        subtitle={egg.description}
                                    />
                                ))}
                            </div>
                        )}
                    </Section>

                    {checkout.variables.length > 0 && (
                        <Section icon={SlidersHorizontal} step={4} title={m['billing.configure.customizeTitle']()} subtitle={m['billing.configure.customizeSubtitle']()}>
                            {checkout.variablesLoading ? (
                                <Spinner className="h-5 w-5" />
                            ) : (
                                <div className="grid gap-5 sm:grid-cols-2">
                                    {checkout.variables.map(v => {
                                        const field = toFieldModel(v);
                                        return (
                                            <VariableField
                                                key={field.env}
                                                field={field}
                                                value={checkout.vars[field.env] ?? v.defaultValue}
                                                onChange={val => checkout.setVar(field.env, val)}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </Section>
                    )}

                    <Section icon={Server} step={checkout.variables.length > 0 ? 5 : 4} title={m['billing.configure.nameTitle']()} subtitle={m['billing.configure.nameSubtitle']()}>
                        <Input
                            value={checkout.serverName}
                            placeholder={m['billing.configure.namePlaceholder']()}
                            invalid={serverNameTouched && nameMissing}
                            maxLength={191}
                            onChange={e => {
                                checkout.setServerName(e.target.value);
                                setServerNameTouched(true);
                            }}
                        />
                        {serverNameTouched && nameMissing && (
                            <p className="mt-1 text-xs text-[var(--color-danger)]">{m['billing.configure.nameRequired']()}</p>
                        )}
                        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border-strong)] p-3">
                            <Switch checked={checkout.legalAgreed} onChange={checkout.setLegalAgreed} />
                            <span className="text-sm text-[var(--color-ink-muted)]">
                                {formatTags(m['billing.configure.legal'](), {
                                    terms: <a href={billing.links.terms} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline" />,
                                    privacy: <a href={billing.links.privacy} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline" />,
                                })}
                            </span>
                        </label>
                    </Section>
                </div>

                <div className="lg:col-span-4">
                    <div className="sticky top-24">
                        <SummaryCart
                            checkout={checkout}
                            cta={
                                <Button size="lg" className="w-full" disabled={!canSubmit} onClick={handleContinue}>
                                    {submitting ? (
                                        <Spinner className="h-5 w-5" />
                                    ) : checkout.isFree ? (
                                        m['billing.configure.createServer']()
                                    ) : (
                                        m['billing.configure.continueToPayment']()
                                    )}
                                </Button>
                            }
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/billing/order"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
            <ArrowLeft className="h-4 w-4" /> {m['billing.configure.back']()}
        </Link>
    );
}

function Empty({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-warning)]">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {children}
        </div>
    );
}
