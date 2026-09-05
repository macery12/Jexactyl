import { m } from '@/i18n/messages';
import type { LandingTestimonialItem, LandingSectionData } from '@/lib/globals';
import Band, { type BandTone } from './Band';

interface Props {
    data: LandingSectionData;
    tone: BandTone;
}

export default function Testimonials({ data, tone }: Props) {
    const items = ((data.items ?? []) as LandingTestimonialItem[]).filter(it => it.quote?.trim());
    if (items.length === 0) return null;

    const heading = data.heading?.trim() || m['landing.testimonials.heading']();

    return (
        <Band tone={tone}>
            <h2 className="mb-8 text-2xl font-semibold tracking-tight">{heading}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item, i) => (
                    <figure
                        key={i}
                        className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6"
                    >
                        <blockquote className="text-sm text-[var(--color-ink)]">“{item.quote}”</blockquote>
                        <figcaption className="mt-4 text-sm">
                            <span className="font-semibold">{item.author}</span>
                            {item.role && <span className="text-[var(--color-ink-muted)]"> · {item.role}</span>}
                        </figcaption>
                    </figure>
                ))}
            </div>
        </Band>
    );
}
