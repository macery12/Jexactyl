import { ChevronDown } from 'lucide-react';
import { m } from '@/i18n/messages';
import type { LandingFaqItem, LandingSectionData } from '@/lib/globals';
import Band, { type BandTone } from './Band';

interface Props {
    data: LandingSectionData;
    tone: BandTone;
}

export default function Faq({ data, tone }: Props) {
    const items = ((data.items ?? []) as LandingFaqItem[]).filter(it => it.q?.trim());
    if (items.length === 0) return null;

    const heading = data.heading?.trim() || m['landing.faq.heading']();

    return (
        <Band tone={tone}>
            <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{heading}</h2>
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
                {items.map((item, i) => (
                    <details
                        key={i}
                        className="group rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-4"
                    >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-medium">
                            {item.q}
                            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)] transition-transform group-open:rotate-180" />
                        </summary>
                        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{item.a}</p>
                    </details>
                ))}
            </div>
        </Band>
    );
}
