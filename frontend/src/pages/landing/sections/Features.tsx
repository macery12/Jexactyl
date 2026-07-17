import { td } from '@/i18n';
import { Gauge, ShieldCheck, Boxes } from 'lucide-react';
import type { LandingFeatureItem, LandingSectionData } from '@/lib/globals';
import { resolveIcon } from './icons';
import Band, { type BandTone } from './Band';

interface Props {
    data: LandingSectionData;
    tone: BandTone;
}

// Built-in defaults shown when the section has no meaningful content yet — keeps
// the original three translated feature cards intact for un-customised panels.
const DEFAULTS = [
    { Icon: Gauge, titleKey: 'landing.features.speed.title', bodyKey: 'landing.features.speed.body' },
    { Icon: ShieldCheck, titleKey: 'landing.features.secure.title', bodyKey: 'landing.features.secure.body' },
    { Icon: Boxes, titleKey: 'landing.features.mods.title', bodyKey: 'landing.features.mods.body' },
] as const;

export default function Features({ data, tone }: Props) {
    const items = (data.items ?? []) as LandingFeatureItem[];
    const hasContent = items.some(it => it.title?.trim() || it.body?.trim());

    if (!hasContent) {
        return (
            <Band tone={tone}>
                <div className="grid gap-4 sm:grid-cols-3">
                    {DEFAULTS.map(({ Icon, titleKey, bodyKey }) => (
                        <FeatureCard key={titleKey} Icon={Icon} title={td(titleKey)} body={td(bodyKey)} />
                    ))}
                </div>
            </Band>
        );
    }

    return (
        <Band tone={tone}>
            <div className="grid gap-4 sm:grid-cols-3">
                {items.map((item, i) => {
                    const Icon = resolveIcon(item.icon);
                    return <FeatureCard key={i} Icon={Icon} title={item.title} body={item.body} />;
                })}
            </div>
        </Band>
    );
}

function FeatureCard({ Icon, title, body }: { Icon: ReturnType<typeof resolveIcon>; title: string; body: string }) {
    return (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6">
            <div className="flex items-center gap-2.5">
                <Icon className="h-4.5 w-4.5 shrink-0 text-[var(--brand-bright)]" />
                <h3 className="text-base font-semibold">{title}</h3>
            </div>
            <p className="mt-2.5 text-sm text-[var(--color-ink-muted)]">{body}</p>
        </div>
    );
}
