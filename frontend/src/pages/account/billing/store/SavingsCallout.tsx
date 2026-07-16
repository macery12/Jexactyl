import { m } from '@/i18n';
import { Percent } from 'lucide-react';

// Slim "save up to X%" banner. `percent` is the best cycle discount available
// (derived from real billing cycles by the page); hidden when there's none.
export function SavingsCallout({ percent }: { percent: number }) {
    if (percent <= 0) return null;
    return (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2.5 text-sm font-medium text-[var(--color-accent)]">
            <Percent className="h-4 w-4 shrink-0" />
            {m['billing.store.savings.text']({ percent })}
        </div>
    );
}
