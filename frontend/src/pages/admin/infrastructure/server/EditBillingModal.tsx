import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Wallet } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useFlashes } from '@/state/flashes';
import { useBilling } from '@/state/billing';
import { getCategories } from '@/api/billingCategories';
import { getProducts, getBillingCycles, type BillingCycle } from '@/api/billingProducts';
import { updateServer, type ServerView } from '@/api/adminServers';

// V1 parity: the three-step billing wizard from EditServerBillingModal.tsx —
// status → plan + cycle → renewal date. Kept as a wizard (rather than folded
// into the editor's scroll) so the plan/cycle/date decisions arrive one at a
// time instead of as one dense block.

interface Draft {
    billable: boolean;
    categoryId: string;
    productId: string;
    billingDays: number | null;
    renewalDate: string;
}

const STEPS = 3;

// A datetime-local value is wall-clock in the viewer's zone; the API wants an
// instant. Reading it back through Date gives us that conversion for free.
function toIso(local: string): string {
    return new Date(local).toISOString();
}

function toLocalInput(iso: string | null): string {
    const d = iso ? new Date(iso) : new Date();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function draftFrom(s: ServerView): Draft {
    return {
        billable: s.billing.productId !== null,
        categoryId: '',
        productId: s.billing.productId ? String(s.billing.productId) : '',
        billingDays: s.billing.days,
        renewalDate: toLocalInput(s.billing.renewalDate),
    };
}

function firstError(err: unknown, fallback: string): string {
    if (isAxiosError(err)) {
        const errors = err.response?.data?.errors;
        if (Array.isArray(errors) && errors[0]?.detail) return errors[0].detail;
        return err.response?.data?.message ?? fallback;
    }
    return fallback;
}

export function EditBillingModal({ open, onClose, server }: { open: boolean; onClose: () => void; server: ServerView }) {
    const qc = useQueryClient();
    const push = useFlashes(st => st.push);
    const { money } = useBilling();

    const [step, setStep] = useState(0);
    const [draft, setDraft] = useState<Draft>(() => draftFrom(server));
    const [saving, setSaving] = useState(false);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

    const categoriesQ = useQuery({ queryKey: ['admin', 'billing-categories'], queryFn: getCategories, enabled: open });

    // Reset to the server's persisted billing every time the wizard opens, so a
    // cancelled run never leaks its edits into the next one.
    useEffect(() => {
        if (open) {
            setStep(0);
            setDraft(draftFrom(server));
        }
    }, [open, server]);

    // Resolve the server's existing plan back to its category. V1 matched the
    // product's categoryUuid against category *ids* and always missed; the
    // catalog exposes uuid, so match on that.
    useEffect(() => {
        if (!open || draft.categoryId || !categoriesQ.data) return;
        const uuid = server.billing.product?.categoryUuid;
        const match = uuid ? categoriesQ.data.find(c => c.uuid === uuid) : undefined;
        if (match) set('categoryId', String(match.id));
        else if (categoriesQ.data.length === 1) set('categoryId', String(categoriesQ.data[0]!.id));
    }, [open, categoriesQ.data, server.billing.product?.categoryUuid, draft.categoryId]);

    const productsQ = useQuery({
        queryKey: ['admin', 'billing-products', draft.categoryId],
        queryFn: () => getProducts(draft.categoryId),
        enabled: open && !!draft.categoryId,
    });

    // Drop a pre-selected plan the loaded category doesn't actually offer —
    // otherwise the select sits blank while the stale id still gates the wizard.
    useEffect(() => {
        const products = productsQ.data;
        if (!products) return;
        setDraft(prev => {
            if (!prev.productId || products.some(p => String(p.id) === prev.productId)) return prev;
            return { ...prev, productId: '', billingDays: null };
        });
    }, [productsQ.data]);

    const cyclesQ = useQuery({
        queryKey: ['admin', 'billing-cycles', draft.categoryId, draft.productId],
        queryFn: () => getBillingCycles(draft.categoryId, draft.productId),
        enabled: open && !!draft.categoryId && !!draft.productId,
    });

    // Once cycles land, keep the server's own cycle if the plan still offers it;
    // otherwise fall back to the plan's default.
    useEffect(() => {
        const cycles = cyclesQ.data;
        if (!cycles?.length) return;
        setDraft(prev => {
            if (prev.billingDays && cycles.some(c => c.days === prev.billingDays)) return prev;
            const fallback = cycles.find(c => c.isDefault) ?? cycles[0]!;
            return { ...prev, billingDays: fallback.days };
        });
    }, [cyclesQ.data]);

    // Changing category invalidates a plan that no longer belongs to it.
    const pickCategory = (id: string) => {
        setDraft(prev => ({ ...prev, categoryId: id, productId: '', billingDays: null }));
    };

    const pickProduct = (id: string) => {
        setDraft(prev => ({ ...prev, productId: id, billingDays: null }));
    };

    const canAdvance = (() => {
        if (!draft.billable) return true;
        if (step === 1) return Boolean(draft.categoryId && draft.productId && draft.billingDays);
        if (step === 2) return Boolean(draft.renewalDate);
        return true;
    })();

    const save = async () => {
        setSaving(true);
        try {
            // The PATCH validator requires identity + feature_limits, and the
            // details service overwrites whatever it receives — so re-send the
            // server's persisted values alongside the billing change.
            await updateServer(server.id, {
                name: server.name,
                external_id: server.externalId,
                description: server.description,
                owner_id: server.ownerId,
                feature_limits: { ...server.featureLimits },
                billing_product_id: draft.billable ? Number(draft.productId) : null,
                billing_days: draft.billable ? draft.billingDays : null,
                renewal_date: draft.billable ? toIso(draft.renewalDate) : null,
            });
            push({ type: 'success', message: m['admin.infrastructure.serverDetail.billing.saved']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'server-view', String(server.id)] });
            onClose();
        } catch (err) {
            push({ type: 'error', message: firstError(err, m['common.states.genericError']()) });
        } finally {
            setSaving(false);
        }
    };

    const title = [
        m['admin.infrastructure.serverDetail.billing.step.status'](),
        m['admin.infrastructure.serverDetail.billing.step.plan'](),
        m['admin.infrastructure.serverDetail.billing.step.renewal'](),
    ][step]!;

    const description = [
        m['admin.infrastructure.serverDetail.billing.step.statusDesc'](),
        m['admin.infrastructure.serverDetail.billing.step.planDesc'](),
        m['admin.infrastructure.serverDetail.billing.step.renewalDesc'](),
    ][step]!;

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={title}
            description={description}
            footer={
                <div className="flex w-full items-center justify-between">
                    <StepDots step={step} />
                    <div className="flex items-center gap-2">
                        {step > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} disabled={saving}>
                                <ChevronLeft className="h-4 w-4" />
                                {m['admin.infrastructure.serverDetail.billing.previous']()}
                            </Button>
                        )}
                        {step < STEPS - 1 ? (
                            <Button size="sm" onClick={() => setStep(step + 1)} disabled={!canAdvance}>
                                {m['admin.infrastructure.serverDetail.billing.next']()}
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        ) : (
                            <Button size="sm" onClick={save} disabled={!canAdvance || saving}>
                                {saving ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                {m['common.actions.saveChanges']()}
                            </Button>
                        )}
                    </div>
                </div>
            }
        >
            {step === 0 && <StatusStep billable={draft.billable} onChange={v => set('billable', v)} />}

            {step > 0 && !draft.billable && (
                <Notice tone="warning">{m['admin.infrastructure.serverDetail.billing.disableConfirm']()}</Notice>
            )}

            {step === 1 && draft.billable && (
                <PlanStep
                    draft={draft}
                    money={money}
                    categories={(categoriesQ.data ?? []).map(c => ({ value: String(c.id), label: c.name }))}
                    categoriesLoading={categoriesQ.isLoading}
                    products={productsQ.data ?? []}
                    productsLoading={productsQ.isFetching}
                    cycles={cyclesQ.data ?? []}
                    cyclesLoading={cyclesQ.isFetching}
                    onCategory={pickCategory}
                    onProduct={pickProduct}
                    onCycle={days => set('billingDays', days)}
                />
            )}

            {step === 2 && draft.billable && (
                <RenewalStep value={draft.renewalDate} onChange={v => set('renewalDate', v)} />
            )}
        </Modal>
    );
}

// ---- Steps --------------------------------------------------------------------

function StatusStep({ billable, onChange }: { billable: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="space-y-5">
            <p className="text-sm text-[var(--color-ink-muted)]">
                {m['admin.infrastructure.serverDetail.billing.statusHelp']()}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                    selected={billable}
                    tone="accent"
                    icon={<Wallet className="h-6 w-6" />}
                    title={m['common.states.enabled']()}
                    body={m['admin.infrastructure.serverDetail.billing.enabledHelp']()}
                    onClick={() => onChange(true)}
                />
                <ChoiceCard
                    selected={!billable}
                    tone="danger"
                    icon={<Clock className="h-6 w-6" />}
                    title={m['common.states.disabled']()}
                    body={m['admin.infrastructure.serverDetail.billing.disabledHelp']()}
                    onClick={() => onChange(false)}
                />
            </div>
            {!billable && <Notice tone="warning">{m['admin.infrastructure.serverDetail.billing.disabledWarning']()}</Notice>}
        </div>
    );
}

function PlanStep({
    draft,
    money,
    categories,
    categoriesLoading,
    products,
    productsLoading,
    cycles,
    cyclesLoading,
    onCategory,
    onProduct,
    onCycle,
}: {
    draft: Draft;
    money: (amount: number) => string;
    categories: { value: string; label: string }[];
    categoriesLoading: boolean;
    products: { id: number; name: string; limits: { cpu: number; memory: number; disk: number } }[];
    productsLoading: boolean;
    cycles: BillingCycle[];
    cyclesLoading: boolean;
    onCategory: (id: string) => void;
    onProduct: (id: string) => void;
    onCycle: (days: number) => void;
}) {
    const productOptions = useMemo(
        () =>
            products.map(p => ({
                value: String(p.id),
                label: m['admin.infrastructure.serverDetail.billing.planOption']({
                    name: p.name,
                    cpu: p.limits.cpu,
                    memory: (p.limits.memory / 1024).toFixed(1),
                    disk: (p.limits.disk / 1024).toFixed(1),
                }),
            })),
        [products],
    );

    return (
        <div className="space-y-6">
            <Field label={m['admin.infrastructure.serverDetail.billing.category']()} desc={m['admin.infrastructure.serverDetail.billing.categoryDesc']()}>
                {categoriesLoading ? (
                    <Loading />
                ) : categories.length === 0 ? (
                    <Notice tone="danger">{m['admin.infrastructure.serverDetail.billing.noCategories']()}</Notice>
                ) : (
                    <Select
                        value={draft.categoryId || undefined}
                        onChange={onCategory}
                        options={categories}
                        placeholder={m['admin.infrastructure.serverDetail.billing.categoryPlaceholder']()}
                    />
                )}
            </Field>

            {draft.categoryId && (
                <Field label={m['admin.infrastructure.serverDetail.billing.plan']()} desc={m['admin.infrastructure.serverDetail.billing.planDescField']()}>
                    {productsLoading ? (
                        <Loading />
                    ) : products.length === 0 ? (
                        <Notice tone="danger">{m['admin.infrastructure.serverDetail.billing.noProducts']()}</Notice>
                    ) : (
                        <Select
                            value={draft.productId || undefined}
                            onChange={onProduct}
                            options={productOptions}
                            placeholder={m['admin.infrastructure.serverDetail.billing.planPlaceholder']()}
                        />
                    )}
                </Field>
            )}

            {draft.productId && (
                <Field label={m['admin.infrastructure.serverDetail.billing.cycle']()} desc={m['admin.infrastructure.serverDetail.billing.cycleDesc']()}>
                    {cyclesLoading ? (
                        <Loading />
                    ) : cycles.length === 0 ? (
                        <Notice tone="danger">{m['admin.infrastructure.serverDetail.billing.noCycles']()}</Notice>
                    ) : (
                        <div className="grid gap-2.5 sm:grid-cols-3">
                            {cycles.map(cycle => (
                                <button
                                    key={cycle.id}
                                    type="button"
                                    onClick={() => onCycle(cycle.days)}
                                    className={cn(
                                        'rounded-xl border px-3.5 py-3 text-left transition-colors',
                                        draft.billingDays === cycle.days
                                            ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                                            : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/50 hover:border-[var(--color-ink-faint)]',
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                                            {m['admin.infrastructure.serverDetail.billing.cycleDays']({ count: cycle.days })}
                                        </span>
                                        {cycle.isDefault && (
                                            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                                                {m['admin.infrastructure.serverDetail.billing.cycleDefault']()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-base font-semibold text-[var(--color-ink)]">{money(cycle.price)}</div>
                                    {cycle.discountPercent !== 0 && (
                                        <div
                                            className={cn(
                                                'mt-0.5 text-[11px]',
                                                cycle.discountPercent > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-warning)]',
                                            )}
                                        >
                                            {cycle.discountPercent > 0
                                                ? m['admin.infrastructure.serverDetail.billing.cycleDiscount']({ percent: cycle.discountPercent })
                                                : m['admin.infrastructure.serverDetail.billing.cyclePremium']({ percent: Math.abs(cycle.discountPercent) })}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </Field>
            )}
        </div>
    );
}

function RenewalStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="space-y-5">
            <Field label={m['admin.infrastructure.serverDetail.billing.renewalDate']()} desc={m['admin.infrastructure.serverDetail.billing.renewalDateDesc']()}>
                <Input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} />
            </Field>
            <Notice tone="info">{m['admin.infrastructure.serverDetail.billing.renewalHint']()}</Notice>
        </div>
    );
}

// ---- Pieces -------------------------------------------------------------------

function StepDots({ step }: { step: number }) {
    return (
        <div className="flex items-center gap-1.5">
            {Array.from({ length: STEPS }).map((_, i) => (
                <span
                    key={i}
                    className={cn(
                        'h-1.5 rounded-full transition-all',
                        i === step ? 'w-5 bg-[var(--brand)]' : 'w-1.5 bg-[var(--color-border-strong)]',
                    )}
                />
            ))}
        </div>
    );
}

function ChoiceCard({
    selected,
    tone,
    icon,
    title,
    body,
    onClick,
}: {
    selected: boolean;
    tone: 'accent' | 'danger';
    icon: React.ReactNode;
    title: string;
    body: string;
    onClick: () => void;
}) {
    const active = tone === 'accent'
        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
        : 'border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)]';

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-xl border px-5 py-4 text-center transition-colors',
                selected ? active : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/50 text-[var(--color-ink-muted)] hover:border-[var(--color-ink-faint)]',
            )}
        >
            <span className="mx-auto mb-2 flex justify-center">{icon}</span>
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">{body}</span>
        </button>
    );
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-ink-muted)]">{label}</label>
            {desc && <span className="text-xs text-[var(--color-ink-faint)]">{desc}</span>}
            <div className="mt-0.5">{children}</div>
        </div>
    );
}

function Notice({ tone, children }: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
    const toneClass = {
        info: 'border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--color-ink-muted)]',
        warning: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
        danger: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
    }[tone];

    return <div className={cn('rounded-xl border px-4 py-3 text-sm', toneClass)}>{children}</div>;
}

function Loading() {
    return (
        <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
        </div>
    );
}
