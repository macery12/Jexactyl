import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { FieldRow, SaveBar, SectionCard, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { getAiStats } from '@/api/adminAi';
import { useAiCapabilities, useAiSettingsForm } from '../useAiSettingsForm';
import { AiLoadError } from '../LoadError';

// What the module is allowed to cost, and who is allowed to reach it.
export default function LimitsPage() {
    const form = useAiSettingsForm(
        settings => ({
            enforce: settings.budget?.enforce ?? false,
            monthly_tokens: settings.budget?.monthly_tokens ?? 2_000_000,
        }),
        value => ({
            budget: { enforce: value.enforce, monthly_tokens: value.monthly_tokens },
        }),
    );

    const { value, patch } = form;
    const capabilities = useAiCapabilities();
    const { data: stats } = useQuery({ queryKey: ['admin', 'ai', 'stats'], queryFn: getAiStats });

    if (form.isError) {
        return <AiLoadError onRetry={form.retry} />;
    }

    if (form.isLoading || !value) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={event => {
                event.preventDefault();
                form.submit();
            }}
        >
            <SectionCard
                icon={Wallet}
                title={m['admin.ai.settings.budget']()}
                desc={
                    capabilities.budgetIsPrimary
                        ? m['admin.ai.pages.budgetHostedDesc']()
                        : m['admin.ai.pages.budgetSelfHostedDesc']()
                }
                right={
                    stats ? (
                        <span className="text-xs text-[var(--color-ink-faint)] tabular-nums">
                            {m['admin.ai.settings.tokensLast7d']({
                                tokens: stats.last_7d.tokens.toLocaleString(),
                            })}
                        </span>
                    ) : undefined
                }
            >
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.ai.settings.budgetEnforce']()}
                        desc={m['admin.ai.settings.budgetEnforceHint']()}
                        checked={value.enforce}
                        onChange={next => patch({ enforce: next })}
                    />
                </ToggleGroup>

                <FieldRow
                    label={m['admin.ai.settings.monthlyTokens']()}
                    desc={m['admin.ai.settings.monthlyTokensHint']()}
                >
                    <Input
                        type="number"
                        min={0}
                        step={100_000}
                        value={value.monthly_tokens}
                        onChange={event => patch({ monthly_tokens: Number(event.target.value) })}
                    />
                </FieldRow>
            </SectionCard>

            <SaveBar dirty={form.dirty} saving={form.saving} onDiscard={form.discard} />
        </form>
    );
}
