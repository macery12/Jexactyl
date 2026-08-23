import { MessageSquareText, SlidersHorizontal } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { FieldRow, SaveBar, SectionCard } from '@/components/ui/editorChrome';
import { IgnoredSettings, type IgnoredSetting } from '../IgnoredSettings';
import { SettingNotice } from '../SettingNotice';
import { SliderRow } from '../SliderRow';
import { useAiCapabilities, useAiSettingsForm } from '../useAiSettingsForm';
import { AiLoadError } from '../LoadError';

const MAX_PROMPT = 1000;

const TEMP_STOPS: { at: number; label: () => string; hint: () => string }[] = [
    { at: 0.0, label: () => m['admin.ai.settings.tempDeterministic'](), hint: () => m['admin.ai.settings.tempDeterministicHint']() },
    { at: 0.3, label: () => m['admin.ai.settings.tempFocused'](), hint: () => m['admin.ai.settings.tempFocusedHint']() },
    { at: 0.7, label: () => m['admin.ai.settings.tempBalanced'](), hint: () => m['admin.ai.settings.tempBalancedHint']() },
    { at: 1.0, label: () => m['admin.ai.settings.tempCreative'](), hint: () => m['admin.ai.settings.tempCreativeHint']() },
];

// What the model is asked for, and how much room it is given to answer.
export default function GenerationPage() {
    const form = useAiSettingsForm(
        settings => ({
            max_tokens: settings.max_tokens ?? 1024,
            temperature: settings.temperature ?? 0.3,
            // Zero means "let the model decide", which is what a null reads as.
            context_tokens: settings.context_tokens ?? 0,
            system_prompt: settings.system_prompt || '',
        }),
        value => ({
            max_tokens: value.max_tokens,
            temperature: value.temperature,
            // Sent as null rather than 0 so the backend reads it as "unset" and
            // falls back to the model's own reported window.
            context_tokens: value.context_tokens > 0 ? value.context_tokens : null,
            system_prompt: value.system_prompt,
        }),
    );

    const { value, patch } = form;
    const capabilities = useAiCapabilities();

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

    const temperature = value.temperature;
    const tempInfo = TEMP_STOPS.reduce((a, b) =>
        Math.abs(b.at - temperature) < Math.abs(a.at - temperature) ? b : a,
    );

    const ignored: IgnoredSetting[] = [];

    if (capabilities.temperature === 'rejected') {
        ignored.push({
            label: m['admin.ai.settings.temperature'](),
            reason: capabilities.probedModel
                ? m['admin.ai.settings.tempRejectedBy']({ model: capabilities.probedModel })
                : m['admin.ai.settings.tempRejected'](),
        });
    }

    if (!capabilities.contextWindow) {
        ignored.push({
            label: m['admin.ai.settings.contextTokens'](),
            reason: m['admin.ai.settings.ollamaOnly'](),
        });
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
                icon={SlidersHorizontal}
                title={m['admin.ai.settings.modelPerformance']()}
                desc={m['admin.ai.pages.generationDesc']()}
            >
                <SliderRow
                    label={m['admin.ai.settings.maxTokens']()}
                    display={String(value.max_tokens)}
                    min={50}
                    max={4000}
                    step={50}
                    value={value.max_tokens}
                    onChange={next => patch({ max_tokens: next })}
                    lowLabel={m['admin.ai.settings.maxTokensLow']()}
                    highLabel={m['admin.ai.settings.maxTokensHigh']()}
                />

                {capabilities.temperature !== 'rejected' && (
                    <div>
                        <SliderRow
                            label={m['admin.ai.settings.temperature']()}
                            display={value.temperature.toFixed(2)}
                            min={0}
                            max={1}
                            step={0.05}
                            value={value.temperature}
                            onChange={next => patch({ temperature: next })}
                            lowLabel={m['admin.ai.settings.tempDeterministic']()}
                            highLabel={m['admin.ai.settings.tempCreative']()}
                        />
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-[var(--brand)]">
                                {tempInfo.label()}
                            </span>
                            <span className="text-xs text-[var(--color-ink-faint)]">{tempInfo.hint()}</span>
                        </div>
                        {/* Tool selection is pinned to 0 regardless, so an agent
                            turn never sees this. Said here rather than left to be
                            discovered by a setting that appears to do nothing. */}
                        {capabilities.temperature === 'agent-pinned' && (
                            <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                                {m['admin.ai.settings.tempAgentPinned']()}
                            </p>
                        )}
                    </div>
                )}

                {capabilities.contextWindow && (
                    <FieldRow
                        label={m['admin.ai.settings.contextTokens']()}
                        desc={m['admin.ai.settings.contextTokensHint']()}
                    >
                        <Input
                            type="number"
                            min={0}
                            step={1024}
                            value={value.context_tokens}
                            onChange={event => patch({ context_tokens: Number(event.target.value) })}
                        />
                    </FieldRow>
                )}

                {capabilities.unboundedContext && (
                    <SettingNotice title={m['admin.ai.settings.contextUnboundTitle']()}>
                        {m['admin.ai.settings.contextUnboundBody']({
                            tokens: (capabilities.probedContextTokens ?? 0).toLocaleString(),
                        })}
                    </SettingNotice>
                )}

                <IgnoredSettings items={ignored} />
            </SectionCard>

            <SectionCard
                icon={MessageSquareText}
                title={m['admin.ai.settings.systemPrompt']()}
                desc={m['admin.ai.settings.systemPromptHint']()}
                right={
                    <span
                        className={cn(
                            'text-xs tabular-nums',
                            value.system_prompt.length > MAX_PROMPT
                                ? 'text-[var(--color-danger)]'
                                : 'text-[var(--color-ink-faint)]',
                        )}
                    >
                        {value.system_prompt.length} / {MAX_PROMPT}
                    </span>
                }
            >
                <Textarea
                    rows={6}
                    value={value.system_prompt}
                    onChange={event => patch({ system_prompt: event.target.value })}
                />
            </SectionCard>

            <SaveBar
                dirty={form.dirty}
                saving={form.saving}
                onDiscard={form.discard}
                blockedReason={
                    value.system_prompt.length > MAX_PROMPT ? m['admin.ai.settings.promptTooLong']() : null
                }
            />
        </form>
    );
}
