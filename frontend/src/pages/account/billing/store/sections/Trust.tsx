import { m } from '@/i18n/messages';
import { Lock, Zap, CreditCard } from 'lucide-react';
import { useBilling } from '@/state/billing';
import type { StoreFeatureItem, StoreSectionData } from '@/lib/globals';
import { resolveIcon } from '@/pages/landing/sections/icons';

// Trust bar: a couple of reassurance tiles plus the accepted payment methods.
// Operator-editable — tiles fall back to the two staged defaults, and the
// accepted-methods chips fall back to the actually-enabled processors (Stripe /
// PayPal) instead of a hardcoded list.
export default function Trust({ data }: { data: StoreSectionData }) {
    const { billing } = useBilling();

    const items = (data.items ?? []) as StoreFeatureItem[];
    const hasTiles = items.some(it => it.title?.trim() || it.body?.trim());

    const tiles = hasTiles
        ? items.map((it, i) => ({ key: `item-${i}`, Icon: resolveIcon(it.icon), title: it.title, body: it.body }))
        : [
              { key: 'secure', Icon: Lock, title: m['billing.store.trust.secureTitle'](), body: m['billing.store.trust.secureBody']() },
              { key: 'instant', Icon: Zap, title: m['billing.store.trust.instantTitle'](), body: m['billing.store.trust.instantBody']() },
          ];

    const acceptedLabel = data.acceptedLabel?.trim() || m['billing.store.trust.accepted']();
    const methods = (data.methods ?? []).map(x => x.trim()).filter(Boolean);
    const resolvedMethods = methods.length > 0 ? methods : deriveMethods(billing);

    return (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="grid gap-5 sm:grid-cols-3">
                {tiles.map(({ key, Icon, title, body }) => (
                    <div key={key} className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--brand)]">
                            <Icon className="h-4 w-4" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
                            <p className="text-xs text-[var(--color-ink-muted)]">{body}</p>
                        </div>
                    </div>
                ))}
                {resolvedMethods.length > 0 && (
                    <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                            <CreditCard className="h-4 w-4" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-[var(--color-ink)]">{acceptedLabel}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {resolvedMethods.map(method => (
                                    <span
                                        key={method}
                                        className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-muted)]"
                                    >
                                        {method}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

// Default accepted-methods chips derived from the processors that are actually
// available on this panel (replaces the old hardcoded ['Stripe', 'PayPal']).
function deriveMethods(billing: ReturnType<typeof useBilling>['billing']): string[] {
    const out: string[] = [];
    if (billing.processors?.stripe?.available) out.push('Stripe');
    if (billing.processors?.paypal?.available) out.push('PayPal');
    return out;
}
