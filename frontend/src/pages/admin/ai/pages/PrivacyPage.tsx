import { ShieldCheck } from 'lucide-react';
import { m, td } from '@/i18n';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { SaveBar, SectionCard, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import type { AiPiiCategory } from '@/api/adminAi';
import { useAiSettingsForm } from '../useAiSettingsForm';
import { AiLoadError } from '../LoadError';

// What is stripped out of tool results and panel-attached context before a
// request leaves the building. Never applied to what the administrator types:
// they chose to send it, and redacting it would break lookup by email for no
// gain.
export default function PrivacyPage() {
    const form = useAiSettingsForm(
        settings => ({
            enabled: settings.privacy?.enabled ?? true,
            // The backend resolves an unset list to the defaults, so what
            // arrives is always the categories actually in force rather than a
            // literal empty selection.
            categories: settings.privacy?.categories ?? [],
        }),
        value => ({ privacy: value }),
    );

    const { settings, value, patch } = form;

    if (form.isError) {
        return <AiLoadError onRetry={form.retry} />;
    }

    if (form.isLoading || !value || !settings) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const available = settings.privacy?.available ?? [];

    // Rebuilt in `available` order on every change rather than appended to, so
    // toggling a category off and back on does not leave the list looking
    // different from the one on file and the form reading as dirty.
    const toggle = (category: AiPiiCategory, on: boolean) => {
        const next = new Set(value.categories);
        if (on) next.add(category);
        else next.delete(category);

        patch({ categories: available.filter(entry => next.has(entry)) });
    };

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={event => {
                event.preventDefault();
                form.submit();
            }}
        >
            <SectionCard
                icon={ShieldCheck}
                title={m['admin.ai.settings.privacy']()}
                desc={m['admin.ai.pages.privacyDesc']()}
            >
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.ai.settings.privacyEnabled']()}
                        desc={m['admin.ai.settings.privacyEnabledHint']()}
                        checked={value.enabled}
                        onChange={next => patch({ enabled: next })}
                    />
                </ToggleGroup>

                <div className={cn('flex flex-col gap-3', !value.enabled && 'opacity-55')}>
                    <div>
                        <p className="text-sm font-medium text-[var(--color-ink)]">
                            {m['admin.ai.settings.privacyCategories']()}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                            {m['admin.ai.settings.privacyCategoriesHint']()}
                        </p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        {available.map(category => (
                            <label
                                key={category}
                                className={cn(
                                    'flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--color-border)] px-3 py-2 transition-colors',
                                    value.enabled && 'hover:border-[var(--color-border-strong)]',
                                    !value.enabled && 'pointer-events-none',
                                )}
                            >
                                <input
                                    type="checkbox"
                                    className="mt-0.5 accent-[var(--brand)]"
                                    checked={value.categories.includes(category)}
                                    disabled={!value.enabled}
                                    onChange={event => toggle(category, event.target.checked)}
                                />
                                <span className="min-w-0">
                                    <span className="block text-xs font-medium text-[var(--color-ink)]">
                                        {td(`admin.ai.settings.pii.${category}`, category)}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] text-[var(--color-ink-faint)]">
                                        {td(`admin.ai.settings.pii.${category}Hint`, '')}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </div>
            </SectionCard>

            <SaveBar dirty={form.dirty} saving={form.saving} onDiscard={form.discard} />
        </form>
    );
}
