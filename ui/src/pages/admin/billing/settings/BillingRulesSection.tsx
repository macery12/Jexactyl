import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, MapPin, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { m } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import {
    updateBillingSetting,
    getNodePricing,
    batchUpdateNodePricing,
    resetAllNodePricing,
    type NodePricing,
} from '@/api/adminBillingSettings';
import { SectionCard, FieldRow } from '../editorChrome';
import { patchBilling } from './patchBilling';

interface Step {
    id: string;
    maxDays: string;
    multiplier: string;
}

const DEFAULT_STEPS: Omit<Step, 'id'>[] = [
    { maxDays: '10', multiplier: '1.30' },
    { maxDays: '20', multiplier: '1.20' },
    { maxDays: '29', multiplier: '1.10' },
    { maxDays: '30', multiplier: '1.00' },
    { maxDays: '59', multiplier: '0.95' },
    { maxDays: '89', multiplier: '0.90' },
    { maxDays: '999', multiplier: '0.85' },
];

let idCounter = 0;
const nextId = () => `step-${idCounter++}`;

function parseSteps(rawSteps: unknown): Step[] {
    if (typeof rawSteps === 'string' && rawSteps) {
        try {
            const parsed = JSON.parse(rawSteps) as { maxDays: number; multiplier: number }[];
            return parsed.map(s => ({ id: nextId(), maxDays: String(s.maxDays), multiplier: Number(s.multiplier).toFixed(2) }));
        } catch {
            /* fall through */
        }
    }
    return DEFAULT_STEPS.map(s => ({ id: nextId(), ...s }));
}

function priceAdjustmentLabel(multiplier: number): string {
    if (Math.abs(multiplier - 1) < 0.001) return m['admin.billing.rules.standard']();
    const pct = Math.round((multiplier - 1) * 100);
    return pct > 0 ? `+${pct}%` : `${pct}%`;
}

export default function BillingRulesSection() {
    const qc = useQueryClient();
    const { push } = useFlashes();
    const { billing } = useBilling();
    const renewal = (billing as Record<string, any>).renewal ?? {};

    const [defaultDays, setDefaultDays] = useState(String(renewal.default_billing_days ?? 30));
    const [steps, setSteps] = useState<Step[]>(() => parseSteps(renewal.multiplier_steps));

    const setStep = (id: string, patch: Partial<Step>) =>
        setSteps(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
    const addStep = () => setSteps(prev => [...prev, { id: nextId(), maxDays: '30', multiplier: '1.00' }]);
    const removeStep = (id: string) => setSteps(prev => prev.filter(s => s.id !== id));

    const saveCycles = useMutation({
        mutationFn: async () => {
            const clean = [...steps]
                .map(s => ({ maxDays: parseInt(s.maxDays, 10) || 0, multiplier: parseFloat(s.multiplier) || 1 }))
                .sort((a, b) => a.maxDays - b.maxDays);
            const days = parseInt(defaultDays, 10) || 30;
            await updateBillingSetting('renewal:default_billing_days', days);
            await updateBillingSetting('renewal:multiplier_steps', JSON.stringify(clean));
            return { days, steps: clean };
        },
        onSuccess: ({ days, steps: clean }) => {
            patchBilling({ renewal: { ...renewal, default_billing_days: days, multiplier_steps: JSON.stringify(clean) } });
            push({ type: 'success', message: m['admin.billing.rules.cyclesSaved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    // --- node pricing ---
    const { data: nodes, isLoading: nodesLoading } = useQuery({
        queryKey: ['admin', 'billing', 'node-pricing'],
        queryFn: getNodePricing,
    });
    const [nodeEdits, setNodeEdits] = useState<Record<number, string>>({});
    const nodeValue = (n: NodePricing) => nodeEdits[n.id] ?? n.priceMultiplier.toFixed(2);

    const saveNodes = useMutation({
        mutationFn: () => {
            const payload = (nodes ?? []).map(n => ({ id: n.id, price_multiplier: parseFloat(nodeValue(n)) || 1 }));
            return batchUpdateNodePricing(payload);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'node-pricing'] });
            setNodeEdits({});
            push({ type: 'success', message: m['admin.billing.rules.nodesSaved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });
    const resetNodes = useMutation({
        mutationFn: () => resetAllNodePricing(),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'node-pricing'] });
            setNodeEdits({});
            push({ type: 'success', message: m['admin.billing.rules.nodesReset']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const nodesDirty = useMemo(() => Object.keys(nodeEdits).length > 0, [nodeEdits]);

    return (
        <div className="flex flex-col gap-6">
            <SectionCard
                id="rules"
                icon={CalendarClock}
                title={m['admin.billing.rules.cyclesTitle']()}
                desc={m['admin.billing.rules.cyclesDesc']()}
                right={
                    <Button variant="outline" size="sm" disabled={saveCycles.isPending} onClick={() => saveCycles.mutate()}>
                        {saveCycles.isPending ? <Spinner className="h-4 w-4" /> : null}
                        {m['common.actions.save']()}
                    </Button>
                }
            >
                <FieldRow label={m['admin.billing.rules.defaultDays']()} desc={m['admin.billing.rules.defaultDaysDesc']()}>
                    <Input type="number" min={1} max={365} value={defaultDays} className="max-w-[160px]" onChange={e => setDefaultDays(e.target.value)} />
                </FieldRow>

                <div className="overflow-hidden rounded-xl border border-[var(--color-border-strong)]">
                    <table className="w-full">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-ink-muted)]">{m['admin.billing.rules.upToDays']()}</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-ink-muted)]">{m['admin.billing.rules.multiplier']()}</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-ink-muted)]">{m['admin.billing.rules.adjustment']()}</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {steps.map(s => (
                                <tr key={s.id}>
                                    <td className="px-3 py-2">
                                        <Input type="number" value={s.maxDays} className="h-9 max-w-[110px]" onChange={e => setStep(s.id, { maxDays: e.target.value })} />
                                    </td>
                                    <td className="px-3 py-2">
                                        <Input type="number" step={0.01} value={s.multiplier} className="h-9 max-w-[110px]" onChange={e => setStep(s.id, { multiplier: e.target.value })} />
                                    </td>
                                    <td className="px-3 py-2 text-sm text-[var(--color-ink-muted)]">{priceAdjustmentLabel(parseFloat(s.multiplier) || 1)}</td>
                                    <td className="px-3 py-2 text-right">
                                        <Button variant="ghost" size="icon" aria-label={m['common.actions.delete']()} disabled={steps.length === 1} onClick={() => removeStep(s.id)}>
                                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <Button variant="ghost" size="sm" onClick={addStep} className="self-start">
                    <Plus className="h-4 w-4" /> {m['admin.billing.rules.addStep']()}
                </Button>
            </SectionCard>

            <SectionCard
                id="node-pricing"
                icon={MapPin}
                title={m['admin.billing.rules.nodesTitle']()}
                desc={m['admin.billing.rules.nodesDesc']()}
                right={
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" disabled={resetNodes.isPending} onClick={() => resetNodes.mutate()}>
                            <RotateCcw className="h-4 w-4" /> {m['admin.billing.rules.resetAll']()}
                        </Button>
                        <Button variant="outline" size="sm" disabled={!nodesDirty || saveNodes.isPending} onClick={() => saveNodes.mutate()}>
                            {saveNodes.isPending ? <Spinner className="h-4 w-4" /> : null}
                            {m['common.actions.save']()}
                        </Button>
                    </div>
                }
            >
                {nodesLoading ? (
                    <div className="flex justify-center py-6">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : (nodes ?? []).length === 0 ? (
                    <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.billing.rules.nodesEmpty']()}</p>
                ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {(nodes ?? []).map(n => (
                            <div key={n.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 px-3 py-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-[var(--color-ink)]">{n.name}</p>
                                    <p className="text-xs text-[var(--color-ink-faint)]">{priceAdjustmentLabel(parseFloat(nodeValue(n)) || 1)}</p>
                                </div>
                                <Input
                                    type="number"
                                    step={0.01}
                                    value={nodeValue(n)}
                                    className="h-9 w-20 shrink-0 px-2 text-center"
                                    onChange={e => setNodeEdits(prev => ({ ...prev, [n.id]: e.target.value }))}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
