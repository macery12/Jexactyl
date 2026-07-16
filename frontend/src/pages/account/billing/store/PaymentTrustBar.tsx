import { m } from '@/i18n';
import { Lock, Zap, CreditCard } from 'lucide-react';

// Trust bar: accepted payment methods plus a couple of reassurance points.
export function PaymentTrustBar() {
    const methods = ['Stripe', 'PayPal'];

    return (
        <section className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
            <div className="grid gap-5 sm:grid-cols-3">
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                        <Lock className="h-4 w-4" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-[var(--color-ink)]">{m['billing.store.trust.secureTitle']()}</p>
                        <p className="text-xs text-[var(--color-ink-muted)]">{m['billing.store.trust.secureBody']()}</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--brand)]">
                        <Zap className="h-4 w-4" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-[var(--color-ink)]">{m['billing.store.trust.instantTitle']()}</p>
                        <p className="text-xs text-[var(--color-ink-muted)]">{m['billing.store.trust.instantBody']()}</p>
                    </div>
                </div>
                {methods.length > 0 && (
                    <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                            <CreditCard className="h-4 w-4" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-[var(--color-ink)]">{m['billing.store.trust.accepted']()}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {methods.map(m => (
                                    <span
                                        key={m}
                                        className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-muted)]"
                                    >
                                        {m}
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
