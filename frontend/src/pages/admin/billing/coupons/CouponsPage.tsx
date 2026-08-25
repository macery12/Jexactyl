import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { useBilling } from '@/state/billing';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getCoupons, deleteCoupon, type Coupon } from '@/api/adminBillingCoupons';
import CouponEditorModal from './CouponEditorModal';

function fmtDate(input: string | null): string {
    if (!input) return m['admin.billing.coupons.never']();
    return new Date(input).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export default function CouponsPage() {
    const qc = useQueryClient();
    const { push } = useFlashes();
    const { billing } = useBilling();
    const held = useAdminHeld();
    const symbol = billing.currency?.symbol ?? '$';

    const [search, setSearch] = useState('');
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<Coupon | null>(null);
    const [delTarget, setDelTarget] = useState<Coupon | null>(null);

    const { data: coupons, isLoading, isError } = useQuery({
        queryKey: ['admin', 'billing', 'coupons'],
        queryFn: getCoupons,
    });

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return coupons ?? [];
        return (coupons ?? []).filter(c => c.code.toLowerCase().includes(q));
    }, [coupons, search]);

    const del = useMutation({
        mutationFn: (id: number) => deleteCoupon(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'billing', 'coupons'] });
            push({ type: 'success', message: m['admin.billing.coupons.deleted']() });
            setDelTarget(null);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const canWrite = can(held, 'billing.update') || can(held, 'billing.read');

    const openNew = () => {
        setEditing(null);
        setEditorOpen(true);
    };
    const openEdit = (c: Coupon) => {
        setEditing(c);
        setEditorOpen(true);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.coupons.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.coupons.subtitle']()}</p>
                </div>
                {canWrite && (
                    <Button size="sm" onClick={openNew}>
                        <Plus className="h-4 w-4" /> {m['admin.billing.coupons.new']()}
                    </Button>
                )}
            </div>

            <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={m['admin.billing.coupons.searchPlaceholder']()} className="pl-9" />
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px]">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                            <tr>
                                {[
                                    m['admin.billing.coupons.code'](),
                                    m['admin.billing.coupons.type'](),
                                    m['admin.billing.coupons.value'](),
                                    m['admin.billing.coupons.usage'](),
                                    m['admin.billing.coupons.status'](),
                                    m['admin.billing.coupons.expiresAt'](),
                                    '',
                                ].map((h, i) => (
                                    <th key={i} className="px-4 py-3 text-left text-xs font-medium text-[var(--color-ink-muted)]">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {filtered.map(c => (
                                <tr key={c.id} className="hover:bg-[var(--color-surface-2)]/40">
                                    <td className="px-4 py-3">
                                        <code className="font-mono text-sm font-semibold text-[var(--color-ink)]">{c.code}</code>
                                    </td>
                                    <td className="px-4 py-3 text-sm capitalize text-[var(--color-ink-muted)]">
                                        {c.type === 'percentage' ? m['admin.billing.coupons.type.percentage']() : m['admin.billing.coupons.type.fixed']()}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink)]">
                                        {c.type === 'percentage' ? `${c.value}%` : `${symbol}${c.value}`}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
                                        {c.usageCount}
                                        {c.maxUses ? ` / ${c.maxUses}` : ''}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span
                                            className={cn(
                                                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                                                c.isActive
                                                    ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                                                    : 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/12 text-[var(--color-danger)]',
                                            )}
                                        >
                                            {c.isActive ? m['admin.billing.coupons.active']() : m['admin.billing.coupons.inactive']()}
                                        </span>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--color-ink-faint)]">{fmtDate(c.expiresAt)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            {canWrite && (
                                                <Button variant="ghost" size="icon" aria-label={m['admin.billing.coupons.edit']()} onClick={() => openEdit(c)}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {canWrite && (
                                                <Button variant="ghost" size="icon" aria-label={m['common.actions.delete']()} onClick={() => setDelTarget(c)}>
                                                    <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-danger)]">{m['admin.billing.common.loadError']()}</p>
                ) : filtered.length === 0 ? (
                    <p className="px-4 py-14 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.billing.coupons.empty']()}</p>
                ) : null}
            </div>

            <CouponEditorModal open={editorOpen} coupon={editing} onClose={() => setEditorOpen(false)} />

            <ConfirmDialog
                open={Boolean(delTarget)}
                onClose={() => setDelTarget(null)}
                title={m['admin.billing.coupons.deleteTitle']()}
                body={m['admin.billing.coupons.deleteBody']({ code: delTarget?.code ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                onConfirm={() => delTarget && del.mutate(delTarget.id)}
            />
        </div>
    );
}
