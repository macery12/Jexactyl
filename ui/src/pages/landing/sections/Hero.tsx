import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { ArrowRight } from 'lucide-react';
import type { LandingSectionData } from '@/lib/globals';

interface Props {
    data: LandingSectionData;
    name: string;
}

// Hero section. Each blank field falls back to the translated Paraglide default,
// preserving the original "Run your game servers like it's effortless" copy when
// an operator hasn't customised anything.
export default function Hero({ data, name }: Props) {
    const badge = data.badge?.trim() || m['landing.badge']();
    const title = data.title?.trim();
    const subtitle = data.subtitle?.trim() || m['landing.subtitle']({ name });
    const primaryLabel = data.primaryCta?.label?.trim() || m['landing.getStarted']();
    // Operator-configured hrefs are raw URLs (external or absolute internal), so
    // they render as plain anchors — the router's basename must not rewrite them.
    const primaryHref = data.primaryCta?.href?.trim() || abs('/auth/login');
    const secondaryLabel = data.secondaryCta?.label?.trim();
    const secondaryHref = data.secondaryCta?.href?.trim() || abs('/auth/login');
    const bg = data.backgroundImage?.trim();

    return (
        <section
            className="relative w-full overflow-hidden"
            style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
            {/* Brand glow that bleeds edge-to-edge so the wide margins read as part
                of the hero rather than empty space. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,var(--brand-soft),transparent)]"
            />
            <div className="mx-auto max-w-6xl px-6 py-20 text-center sm:py-28">
                {badge && (
                    <span className="inline-flex items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 px-3 py-1 text-xs text-[var(--color-ink-muted)]">
                        {badge}
                    </span>
                )}
                <h1 className="mx-auto mt-6 max-w-3xl text-balance text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
                    {title ? (
                        title
                    ) : (
                        <>
                            {m['landing.heroPre']()} <span className="text-[var(--brand)]">{m['landing.heroEmphasis']()}</span>.
                        </>
                    )}
                </h1>
                <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-[var(--color-ink-muted)]">{subtitle}</p>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                    <a
                        href={primaryHref}
                        className="group inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--brand)] px-7 text-sm font-semibold text-[var(--color-brand-ink)] shadow-lg shadow-[var(--brand)]/25 hover:bg-[var(--brand-hover)]"
                    >
                        {primaryLabel}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </a>
                    {secondaryLabel && (
                        <a
                            href={secondaryHref}
                            className="inline-flex h-12 items-center rounded-xl border border-[var(--color-border-strong)] px-7 text-sm font-medium hover:bg-[var(--color-surface-2)]"
                        >
                            {secondaryLabel}
                        </a>
                    )}
                </div>
            </div>
        </section>
    );
}
