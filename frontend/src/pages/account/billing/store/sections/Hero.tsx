import { m } from '@/i18n/messages';
import { Sparkles, ArrowRight, Megaphone } from 'lucide-react';
import type { StoreSectionData } from '@/lib/globals';

// Marketing hero + promo strip for the store. Every blank operator field falls
// back to the translated Paraglide default, so an un-customised panel keeps its
// original copy. Operator strings render as escaped text — never raw HTML.
export default function Hero({ data }: { data: StoreSectionData }) {
    const badge = data.badge?.trim() || m['billing.store.hero.badge']();
    const title = data.title?.trim() || m['billing.store.hero.title']();
    const subtitle = data.subtitle?.trim() || m['billing.store.hero.subtitle']();
    const ctaLabel = data.primaryCta?.label?.trim() || m['billing.store.hero.ctaPrimary']();
    // The default target is the in-page catalog anchor; operators may point it
    // anywhere (validated server-side to same-origin / http(s) / #anchor).
    const ctaHref = data.primaryCta?.href?.trim() || '#plans';
    const promo = data.promoText?.trim() || m['billing.store.promo.text']();
    const bg = data.backgroundImage?.trim();

    return (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
            <div
                className="bg-aurora relative px-6 py-10 sm:px-10 sm:py-14"
                style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                    <Sparkles className="h-3.5 w-3.5" /> {badge}
                </span>
                <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-[var(--color-ink)] sm:text-4xl">
                    {title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-muted)] sm:text-base">{subtitle}</p>
                <div className="mt-6">
                    <a
                        href={ctaHref}
                        className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-5 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                    >
                        {ctaLabel} <ArrowRight className="h-4 w-4" />
                    </a>
                </div>
            </div>
            {promo && (
                <div className="flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-6 py-3 text-sm text-[var(--color-ink-muted)] sm:px-10">
                    <Megaphone className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                    {promo}
                </div>
            )}
        </section>
    );
}
