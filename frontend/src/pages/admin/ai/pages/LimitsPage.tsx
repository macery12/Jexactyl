import { useQuery } from '@tanstack/react-query';
import { Users, Wallet } from 'lucide-react';
import { m } from '@/i18n';
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
            feature_server_assistant: settings.feature_server_assistant ?? true,
            feature_crash_analysis: settings.feature_crash_analysis ?? true,
        }),
        value => ({
            budget: { enforce: value.enforce, monthly_tokens: value.monthly_tokens },
            feature_server_assistant: value.feature_server_assistant,
            feature_crash_analysis: value.feature_crash_analysis,
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

            <SectionCard icon={Users} title={m['admin.ai.settings.access']()} desc={m['admin.ai.pages.accessDesc']()}>
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.ai.settings.serverAssistant']()}
                        desc={m['admin.ai.settings.serverAssistantHint']()}
                        checked={value.feature_server_assistant}
                        onChange={next => patch({ feature_server_assistant: next })}
                    />
                    <ToggleRow
                        label={m['admin.ai.settings.crashAnalysis']()}
                        desc={m['admin.ai.settings.crashAnalysisHint']()}
                        checked={value.feature_crash_analysis}
                        onChange={next => patch({ feature_crash_analysis: next })}
                    />
                </ToggleGroup>

                <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.adminsAlways']()}</p>
            </SectionCard>

            <SaveBar dirty={form.dirty} saving={form.saving} onDiscard={form.discard} />
        </form>
    );
}
