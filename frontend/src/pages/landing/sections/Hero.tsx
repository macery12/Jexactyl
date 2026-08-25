import { m } from '@/i18n/messages';
import { abs } from '@/lib/base';
import Cockpit from './Cockpit';
import type { LandingSectionData } from '@/lib/globals';

interface Props {
    data: LandingSectionData;
    name: string;
}

// Asymmetric hero: copy on the left, a simulated live server cockpit on the
// right — the product demonstrates itself instead of a slogan doing it. Every
// blank operator field falls back to the translated Paraglide default; the old
// `badge` field now feeds the mono eyebrow above the headline.
export default function Hero({ data, name }: Props) {
    const eyebrow = data.badge?.trim() || m['landing.eyebrow']();
    const title = data.title?.trim() || m['landing.heroTitle']();
    const subtitle = data.subtitle?.trim() || m['landing.subtitle']({ name });
    const primaryLabel = data.primaryCta?.label?.trim() || m['landing.getStarted']();
    // Operator-configured hrefs are raw URLs (external or absolute internal), so
    // they render as plain anchors — the router's basename must not rewrite them.
    const primaryHref = data.primaryCta?.href?.trim() || abs('/auth/login');
    const secondaryLabel = data.secondaryCta?.label?.trim();
    const secondaryHref = data.secondaryCta?.href?.trim() || abs('/auth/login');
    const bg = data.backgroundImage?.trim();

    const specs = [
        m['landing.spec.console'](),
        m['landing.spec.mods'](),
        m['landing.spec.schedules'](),
        m['landing.spec.sftp'](),
        m['landing.spec.subusers'](),
    ];

    return (
        <section
            className="relative w-full overflow-hidden"
            style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
            <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-20 lg:grid-cols-2 lg:gap-14">
                <div>
                    <div className="flex items-center gap-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-bright)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                        {eyebrow}
                    </div>
                    <h1 className="mt-4 text-balance text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl">
                        {title}
                    </h1>
                    <p className="mt-5 max-w-xl text-pretty text-lg text-[var(--color-ink-muted)]">{subtitle}</p>
                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <a
                            href={primaryHref}
                            className="inline-flex h-11 items-center rounded-lg bg-[var(--brand)] px-6 text-sm font-semibold text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                        >
                            {primaryLabel}
                        </a>
                        {secondaryLabel && (
                            <a
                                href={secondaryHref}
                                className="inline-flex h-11 items-center rounded-lg border border-[var(--color-border-strong)] px-6 text-sm font-medium hover:bg-[var(--color-surface-2)]"
                            >
                                {secondaryLabel}
                            </a>
                        )}
                    </div>
                    <div className="mt-9 flex flex-wrap items-center gap-y-1.5 font-mono text-[11px] tracking-[0.06em] text-[var(--color-ink-muted)]">
                        {specs.map((spec, i) => (
                            <span key={spec} className="flex items-center uppercase">
                                {i > 0 && <span className="mx-2.5 text-[var(--color-border-strong)]">{'//'}</span>}
                                {spec}
                            </span>
                        ))}
                    </div>
                </div>
                <Cockpit />
            </div>
        </section>
    );
}
