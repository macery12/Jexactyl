import { m } from '@/i18n';
import { Sparkles, ArrowRight, Megaphone } from 'lucide-react';

// Marketing hero + promo strip for the store. Copy comes from the billing
// catalog (translator-ready); the host will be able to override it from config
// in a later pass — for now it's sensible default copy.
export function StoreHero() {
    return (
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <div className="bg-aurora relative px-6 py-10 sm:px-10 sm:py-14">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                    <Sparkles className="h-3.5 w-3.5" /> {m['billing.store.hero.badge']()}
                </span>
                <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-[var(--color-ink)] sm:text-4xl">
                    {m['billing.store.hero.title']()}
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-muted)] sm:text-base">
                    {m['billing.store.hero.subtitle']()}
                </p>
                <div className="mt-6">
                    <a
                        href="#plans"
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                    >
                        {m['billing.store.hero.ctaPrimary']()} <ArrowRight className="h-4 w-4" />
                    </a>
                </div>
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-6 py-3 text-sm text-[var(--color-ink-muted)] sm:px-10">
                <Megaphone className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                {m['billing.store.promo.text']()}
            </div>
        </section>
    );
}
