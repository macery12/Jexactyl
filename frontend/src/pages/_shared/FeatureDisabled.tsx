import { PowerOff } from 'lucide-react';
import { m } from '@/i18n';

// Shown when a feature's route is reached directly (typed URL, stale bookmark,
// back button) while its module is switched off on the admin Features page.
// The nav already hides these tabs; this is the fallback for direct access so
// the panel explains the absence instead of rendering a broken/empty page.
export default function FeatureDisabled({ name }: { name?: string }) {
    return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
                <PowerOff className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-lg font-semibold text-[var(--color-ink)]">
                {m['common.featureDisabled.title']()}
            </h1>
            <p className="mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
                {name
                    ? m['common.featureDisabled.bodyNamed']({ name })
                    : m['common.featureDisabled.body']()}
            </p>
        </div>
    );
}
