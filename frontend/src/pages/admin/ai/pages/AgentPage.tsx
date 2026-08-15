import { Bot, Timer } from 'lucide-react';
import { m } from '@/i18n';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { FieldGrid, FieldRow, SaveBar, SectionCard, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { useAiSettingsForm } from '../useAiSettingsForm';

// The agent: which assistants exist, and how far a single turn may run.
export default function AgentPage() {
    const form = useAiSettingsForm(
        settings => ({
            enabled: settings.agent?.enabled ?? false,
            admin_enabled: settings.agent?.admin_enabled ?? false,
            reasoning: settings.agent?.reasoning ?? true,
            max_steps: settings.agent?.max_steps ?? 12,
            max_wall_seconds: settings.agent?.max_wall_seconds ?? 180,
            tool_result_bytes: settings.agent?.tool_result_bytes ?? 12288,
            max_tools: settings.agent?.max_tools ?? 20,
        }),
        value => ({ agent: value }),
    );

    const { value, patch } = form;

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
            <SectionCard icon={Bot} title={m['admin.ai.settings.agent']()} desc={m['admin.ai.pages.agentDesc']()}>
                <ToggleGroup>
                    <ToggleRow
                        label={m['admin.ai.settings.agentEnabled']()}
                        desc={m['admin.ai.settings.agentEnabledHint']()}
                        checked={value.enabled}
                        onChange={next => patch({ enabled: next })}
                    />
                    <ToggleRow
                        label={m['admin.ai.settings.adminAgentEnabled']()}
                        desc={m['admin.ai.settings.adminAgentEnabledHint']()}
                        checked={value.admin_enabled}
                        onChange={next => patch({ admin_enabled: next })}
                        disabled={!value.enabled}
                    />
                    <ToggleRow
                        label={m['admin.ai.settings.agentReasoning']()}
                        desc={m['admin.ai.settings.agentReasoningHint']()}
                        checked={value.reasoning}
                        onChange={next => patch({ reasoning: next })}
                        disabled={!value.enabled}
                    />
                </ToggleGroup>
            </SectionCard>

            <SectionCard icon={Timer} title={m['admin.ai.settings.turnLimits']()} desc={m['admin.ai.pages.turnLimitsDesc']()}>
                <FieldGrid>
                    <FieldRow label={m['admin.ai.settings.maxSteps']()} desc={m['admin.ai.settings.maxStepsHint']()}>
                        <Input
                            type="number"
                            min={1}
                            max={50}
                            value={value.max_steps}
                            onChange={event => patch({ max_steps: Number(event.target.value) })}
                        />
                    </FieldRow>
                    <FieldRow label={m['admin.ai.settings.maxWall']()} desc={m['admin.ai.settings.maxWallHint']()}>
                        <Input
                            type="number"
                            min={15}
                            max={900}
                            value={value.max_wall_seconds}
                            onChange={event => patch({ max_wall_seconds: Number(event.target.value) })}
                        />
                    </FieldRow>
                    <FieldRow label={m['admin.ai.settings.maxTools']()} desc={m['admin.ai.settings.maxToolsHint']()}>
                        <Input
                            type="number"
                            min={4}
                            max={64}
                            value={value.max_tools}
                            onChange={event => patch({ max_tools: Number(event.target.value) })}
                        />
                    </FieldRow>
                    <FieldRow
                        label={m['admin.ai.settings.toolResultBytes']()}
                        desc={m['admin.ai.settings.toolResultBytesHint']()}
                    >
                        <Input
                            type="number"
                            min={1024}
                            max={131072}
                            step={1024}
                            value={value.tool_result_bytes}
                            onChange={event => patch({ tool_result_bytes: Number(event.target.value) })}
                        />
                    </FieldRow>
                </FieldGrid>
            </SectionCard>

            <SaveBar dirty={form.dirty} saving={form.saving} onDiscard={form.discard} />
        </form>
    );
}
