import { m, td } from '@/i18n/messages';
import { ShieldCheck, Zap, HardDrive, LifeBuoy } from 'lucide-react';
import type { StoreFeatureItem, StoreSectionData } from '@/lib/globals';
import { resolveIcon } from '@/pages/landing/sections/icons';

// Built-in defaults shown when the section has no meaningful content yet — keeps
// the four staged "why host with us" cards for un-customised panels.
const DEFAULTS = [
    { Icon: ShieldCheck, titleKey: 'billing.store.features.ddosTitle', bodyKey: 'billing.store.features.ddosBody' },
    { Icon: Zap, titleKey: 'billing.store.features.instantTitle', bodyKey: 'billing.store.features.instantBody' },
    { Icon: HardDrive, titleKey: 'billing.store.features.nvmeTitle', bodyKey: 'billing.store.features.nvmeBody' },
    { Icon: LifeBuoy, titleKey: 'billing.store.features.supportTitle', bodyKey: 'billing.store.features.supportBody' },
] as const;

// Feature grid: icon + title + body cards. Falls back to the staged defaults when
// the operator hasn't filled in any card content.
export default function Features({ data }: { data: StoreSectionData }) {
    const heading = data.heading?.trim() || m['billing.store.features.heading']();
    const items = (data.items ?? []) as StoreFeatureItem[];
    const hasContent = items.some(it => it.title?.trim() || it.body?.trim());

    const cards = hasContent
        ? items.map((it, i) => {
              const Icon = resolveIcon(it.icon);
              return { key: `item-${i}`, Icon, title: it.title, body: it.body };
          })
        : DEFAULTS.map(d => ({ key: d.titleKey, Icon: d.Icon, title: td(d.titleKey), body: td(d.bodyKey) }));

    return (
        <section className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{heading}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map(({ key, Icon, title, body }) => (
                    <div key={key} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-5">
                        <div className="flex items-center gap-2.5">
                            <Icon className="h-4.5 w-4.5 shrink-0 text-[var(--brand-bright)]" />
                            <h3 className="text-base font-semibold text-[var(--color-ink)]">{title}</h3>
                        </div>
                        <p className="mt-2.5 text-sm text-[var(--color-ink-muted)]">{body}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
