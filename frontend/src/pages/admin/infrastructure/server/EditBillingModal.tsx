import { m } from '@/i18n';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useFlashes } from '@/state/flashes';
import { useBilling } from '@/state/billing';
import { getCategories } from '@/api/billingCategories';
import { getProducts, getBillingCycles, type BillingCycle } from '@/api/billingProducts';
import { updateServer, type ServerView } from '@/api/adminServers';

// One flat form: billable toggle → category/plan → cycle → renewal date, all
// visible at once so the whole change can be reviewed before saving. (Replaced
// the V1-parity three-step wizard.)

interface Draft {
    billable: boolean;
    categoryId: string;
    productId: string;
    billingDays: number | null;
    renewalDate: string;
}

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

    const [draft, setDraft] = useState<Draft>(() => draftFrom(server));
    const [saving, setSaving] = useState(false);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

    const categoriesQ = useQuery({ queryKey: ['admin', 'billing-categories'], queryFn: getCategories, enabled: open });

    // Reset to the server's persisted billing every time the modal opens, so a
    // cancelled run never leaks its edits into the next one.
    useEffect(() => {
        if (open) setDraft(draftFrom(server));
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
    // otherwise the select sits blank while the stale id still gates the save.
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

    const canSave = !draft.billable
        || Boolean(draft.categoryId && draft.productId && draft.billingDays && draft.renewalDate);

    // Saving disabled billing on an already-billable server clears its plan.
    const clearsPlan = !draft.billable && server.billing.productId !== null;

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

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={m['admin.infrastructure.serverDetail.billing.title']()}
            description={m['admin.infrastructure.serverDetail.billing.desc']()}
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={save} disabled={!canSave || saving}>
                        {saving ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        {m['common.actions.saveChanges']()}
                    </Button>
                </div>
            }
        >
            <div className="space-y-6">
                <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-3.5">
                    <Switch checked={draft.billable} onChange={v => set('billable', v)} />
                    <span className="text-sm text-[var(--color-ink)]">
                        {m['admin.infrastructure.serverDetail.billing.enableLabel']()}
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">
                            {m['admin.infrastructure.serverDetail.billing.statusHelp']()}
                        </span>
                    </span>
                </label>

                {clearsPlan && (
                    <Notice tone="warning">{m['admin.infrastructure.serverDetail.billing.disableConfirm']()}</Notice>
                )}

                {draft.billable && (
                    <>
                        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                            <Field label={m['admin.infrastructure.serverDetail.billing.category']()} desc={m['admin.infrastructure.serverDetail.billing.categoryDesc']()}>
                                {categoriesQ.isLoading ? (
                                    <Loading />
                                ) : (categoriesQ.data ?? []).length === 0 ? (
                                    <Notice tone="danger">{m['admin.infrastructure.serverDetail.billing.noCategories']()}</Notice>
                                ) : (
                                    <Select
                                        value={draft.categoryId || undefined}
                                        onChange={pickCategory}
                                        options={(categoriesQ.data ?? []).map(c => ({ value: String(c.id), label: c.name }))}
                                        placeholder={m['admin.infrastructure.serverDetail.billing.categoryPlaceholder']()}
                                    />
                                )}
                            </Field>

                            <Field label={m['admin.infrastructure.serverDetail.billing.plan']()} desc={m['admin.infrastructure.serverDetail.billing.planDescField']()}>
                                {!draft.categoryId ? (
                                    <Select value={undefined} onChange={() => undefined} options={[]} placeholder={m['admin.infrastructure.serverDetail.billing.planPlaceholder']()} disabled />
                                ) : productsQ.isFetching ? (
                                    <Loading />
                                ) : (productsQ.data ?? []).length === 0 ? (
                                    <Notice tone="danger">{m['admin.infrastructure.serverDetail.billing.noProducts']()}</Notice>
                                ) : (
                                    <Select
                                        value={draft.productId || undefined}
                                        onChange={pickProduct}
                                        options={(productsQ.data ?? []).map(p => ({
                                            value: String(p.id),
                                            label: m['admin.infrastructure.serverDetail.billing.planOption']({
                                                name: p.name,
                                                cpu: p.limits.cpu,
                                                memory: (p.limits.memory / 1024).toFixed(1),
                                                disk: (p.limits.disk / 1024).toFixed(1),
                                            }),
                                        }))}
                                        placeholder={m['admin.infrastructure.serverDetail.billing.planPlaceholder']()}
                                    />
                                )}
                            </Field>
                        </div>

                        {draft.productId && (
                            <Field label={m['admin.infrastructure.serverDetail.billing.cycle']()} desc={m['admin.infrastructure.serverDetail.billing.cycleDesc']()}>
                                {cyclesQ.isFetching ? (
                                    <Loading />
                                ) : (cyclesQ.data ?? []).length === 0 ? (
                                    <Notice tone="danger">{m['admin.infrastructure.serverDetail.billing.noCycles']()}</Notice>
                                ) : (
                                    <div className="grid gap-2.5 sm:grid-cols-3">
                                        {(cyclesQ.data ?? []).map(cycle => (
                                            <CycleCard
                                                key={cycle.id}
                                                cycle={cycle}
                                                selected={draft.billingDays === cycle.days}
                                                money={money}
                                                onClick={() => set('billingDays', cycle.days)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </Field>
                        )}

                        <Field label={m['admin.infrastructure.serverDetail.billing.renewalDate']()} desc={m['admin.infrastructure.serverDetail.billing.renewalDateDesc']()}>
                            <Input type="datetime-local" value={draft.renewalDate} onChange={e => set('renewalDate', e.target.value)} />
                        </Field>
                    </>
                )}
            </div>
        </Modal>
    );
}

// ---- Pieces -------------------------------------------------------------------

function CycleCard({
    cycle,
    selected,
    money,
    onClick,
}: {
    cycle: BillingCycle;
    selected: boolean;
    money: (amount: number) => string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-lg border px-3.5 py-3 text-left transition-colors',
                selected
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'border-[var(--color-border-strong)] hover:border-[var(--color-ink-faint)]',
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                    {m['admin.infrastructure.serverDetail.billing.cycleDays']({ count: cycle.days })}
                </span>
                {cycle.isDefault && (
                    <span className="rounded-sm bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                        {m['admin.infrastructure.serverDetail.billing.cycleDefault']()}
                    </span>
                )}
            </div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--color-ink)]">{money(cycle.price)}</div>
            {cycle.discountPercent !== 0 && (
                <div
                    className={cn(
                        'mt-0.5 font-mono text-[11px] tabular-nums',
                        cycle.discountPercent > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-warning)]',
                    )}
                >
                    {cycle.discountPercent > 0
                        ? m['admin.infrastructure.serverDetail.billing.cycleDiscount']({ percent: cycle.discountPercent })
                        : m['admin.infrastructure.serverDetail.billing.cyclePremium']({ percent: Math.abs(cycle.discountPercent) })}
                </div>
            )}
        </button>
    );
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-ink-muted)]">{label}</label>
            <div>{children}</div>
            {desc && <span className="text-xs text-[var(--color-ink-faint)]">{desc}</span>}
        </div>
    );
}

function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: React.ReactNode }) {
    const toneClass = {
        warning: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
        danger: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
    }[tone];

    return <div className={cn('rounded-lg border px-4 py-3 text-sm', toneClass)}>{children}</div>;
}

function Loading() {
    return (
        <div className="flex justify-center py-4">
            <Spinner className="h-5 w-5" />
        </div>
    );
}
