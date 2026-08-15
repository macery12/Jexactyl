import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A setting that is stored, valid, and not doing what it looks like it does.
 *
 * The sibling of {@link IgnoredSettings}, for the case it cannot cover. That one
 * answers "this control does nothing here", which it can state flatly because
 * the provider decides it. This one answers "this combination will cost you
 * something you did not ask for" — a judgement about a configuration that is
 * perfectly legal, which is why it argues rather than merely lists, and why it
 * is not folded away behind a disclosure the way the ignored set is.
 *
 * Deliberately not an error tone. Nothing is broken; the operator is one
 * decision away from what they meant.
 */
export function SettingNotice({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="flex gap-2.5 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/[0.07] px-3.5 py-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
            <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-ink)]">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">{children}</p>
            </div>
        </div>
    );
}
