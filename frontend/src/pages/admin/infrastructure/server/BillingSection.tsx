import { m } from '@/i18n';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useBilling } from '@/state/billing';
import { useServerView } from './ServerContext';
import { EditBillingModal } from './EditBillingModal';

// Days/hours until a renewal, or nulls once it's in the past.
function timeUntil(iso: string): { days: number; hours: number; overdue: boolean } {
    const diff = new Date(iso).getTime() - Date.now();
    const overdue = diff < 0;
    const abs = Math.abs(diff);
    return {
        days: Math.floor(abs / 86_400_000),
        hours: Math.floor((abs / 3_600_000) % 24),
        overdue,
    };
}

export function BillingSection({ readOnly }: { readOnly: boolean }) {
    const s = useServerView();
    const { billing: config, money } = useBilling();
    const [editing, setEditing] = useState(false);

    const product = s.billing.product;
    const days = s.billing.days;

    return (
        <div className="flex flex-col gap-5">
            {!config.enabled && (
                <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-warning)]">
                    {m['admin.infrastructure.serverDetail.billing.moduleDisabled']()}
                </div>
            )}

            <div className="flex items-start justify-between gap-4">
                <div className="grid flex-1 gap-x-6 gap-y-4 sm:grid-cols-3">
                    <Summary label={m['admin.infrastructure.serverDetail.billing.summary.plan']()}>
                        {!s.billing.productId ? (
                            <Muted>{m['admin.infrastructure.serverDetail.billing.none']()}</Muted>
                        ) : !product ? (
                            <Muted>{m['admin.infrastructure.serverDetail.billing.planMissing']()}</Muted>
                        ) : (
                            <>
                                <span className="font-semibold text-[var(--color-ink)]">{product.name}</span>
                                <span className="block font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                                    {m['admin.infrastructure.serverDetail.billing.summary.priceEvery']({
                                        price: money(product.price),
                                        count: days ?? 30,
                                    })}
                                </span>
                            </>
                        )}
                    </Summary>

                    <Summary label={m['admin.infrastructure.serverDetail.billing.summary.renewal']()}>
                        {!s.billing.renewalDate ? (
                            <Muted>{m['admin.infrastructure.serverDetail.billing.none']()}</Muted>
                        ) : (
                            <Renewal iso={s.billing.renewalDate} />
                        )}
                    </Summary>

                    <Summary label={m['admin.infrastructure.serverDetail.billing.summary.limits']()}>
                        {!product ? (
                            <Muted>{m['admin.infrastructure.serverDetail.billing.none']()}</Muted>
                        ) : (
                            <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">
                                {m['admin.infrastructure.serverDetail.billing.summary.limitsValue']({
                                    cpu: product.limits.cpu,
                                    memory: (product.limits.memory / 1024).toFixed(1),
                                    disk: (product.limits.disk / 1024).toFixed(1),
                                })}
                            </span>
                        )}
                    </Summary>
                </div>

                {!readOnly && (
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        <Pencil className="h-3.5 w-3.5" />
                        {m['common.actions.edit']()}
                    </Button>
                )}
            </div>

            {!readOnly && <EditBillingModal open={editing} onClose={() => setEditing(false)} server={s} />}
        </div>
    );
}

function Renewal({ iso }: { iso: string }) {
    const { days, hours, overdue } = timeUntil(iso);
    return (
        <>
            <span className="font-mono font-medium tabular-nums text-[var(--color-ink)]">{new Date(iso).toLocaleDateString()}</span>
            <span className={cn('block font-mono text-xs tabular-nums', overdue ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]')}>
                {overdue
                    ? m['admin.infrastructure.serverDetail.billing.summary.overdue']({ days, hours })
                    : m['admin.infrastructure.serverDetail.billing.summary.remaining']({ days, hours })}
            </span>
        </>
    );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">{label}</p>
            <div className="text-sm">{children}</div>
        </div>
    );
}

function Muted({ children }: { children: React.ReactNode }) {
    return <span className="text-[var(--color-ink-faint)]">{children}</span>;
}
