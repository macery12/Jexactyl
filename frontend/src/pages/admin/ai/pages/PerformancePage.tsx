import { useQuery } from '@tanstack/react-query';
import { Gauge, HardDrive, Layers } from 'lucide-react';
import { m } from '@/i18n';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { FieldGrid, FieldRow, SaveBar, SectionCard, ToggleGroup, ToggleRow } from '@/components/ui/editorChrome';
import { getAiInference } from '@/api/adminAi';
import { IgnoredSettings, type IgnoredSetting } from '../IgnoredSettings';
import { AI_INFERENCE_KEY, useAiCapabilities, useAiSettingsForm } from '../useAiSettingsForm';
import { AiLoadError } from '../LoadError';

function formatVram(bytes: number | undefined): string | null {
    if (!bytes) return null;

    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Keeping a self-hosted GPU busy without thrashing it: how long a model stays
// resident, and how many turns may run at once before the rest queue.
export default function PerformancePage() {
    const form = useAiSettingsForm(
        settings => ({
            keep_alive: settings.keep_alive || '10m',
            warm: settings.warm ?? false,
            slots: settings.concurrency?.slots ?? 0,
            per_user: settings.concurrency?.per_user ?? 1,
            queue_depth: settings.concurrency?.queue_depth ?? 20,
            max_wait_seconds: settings.concurrency?.max_wait_seconds ?? 120,
        }),
        value => ({
            keep_alive: value.keep_alive,
            warm: value.warm,
            concurrency: {
                // Zero means "derive it from the model probe", which is what a
                // null reads as on the way in.
                slots: value.slots > 0 ? value.slots : null,
                per_user: value.per_user,
                queue_depth: value.queue_depth,
                max_wait_seconds: value.max_wait_seconds,
            },
        }),
    );

    const { value, patch } = form;
    const capabilities = useAiCapabilities();

    const { data: inference } = useQuery({
        queryKey: AI_INFERENCE_KEY,
        queryFn: getAiInference,
        retry: false,
        staleTime: 60_000,
    });

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

    // A hosted provider runs on someone else's hardware: there is no residency
    // to manage and no slot to contend for. Say so rather than showing controls
    // that would be saved and ignored.
    if (!capabilities.queue && !capabilities.keepAlive) {
        return (
            <SectionCard
                icon={Gauge}
                title={m['admin.ai.settings.queue']()}
                desc={m['admin.ai.pages.performanceDesc']()}
            >
                <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.ai.settings.queueHostedNote']()}</p>
            </SectionCard>
        );
    }

    const queue = inference?.queue;
    const resident = inference?.resident_models ?? [];

    // Self-hosted but not Ollama — an OpenAI-compatible server in front of
    // llama.cpp, vLLM or Ollama's own shim. Residency is a real thing there, we
    // just have no way to ask for it: `keep_alive` is an Ollama request field
    // and anything else accepts it and drops it. The queue controls below still
    // apply, so the page renders; these two do not, so they are declared rather
    // than silently missing.
    const ignored: IgnoredSetting[] = capabilities.keepAlive
        ? []
        : [
              { label: m['admin.ai.settings.keepAlive'](), reason: m['admin.ai.settings.selfHostedNotOllama']() },
              { label: m['admin.ai.settings.warm'](), reason: m['admin.ai.settings.selfHostedNotOllama']() },
          ];

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={event => {
                event.preventDefault();
                form.submit();
            }}
        >
            {capabilities.keepAlive && (
                <SectionCard
                    icon={HardDrive}
                    title={m['admin.ai.settings.ollamaPerformance']()}
                    desc={m['admin.ai.pages.residencyDesc']()}
                >
                    <FieldRow label={m['admin.ai.settings.keepAlive']()} desc={m['admin.ai.settings.keepAliveHint']()}>
                        <Select
                            value={value.keep_alive}
                            onChange={next => patch({ keep_alive: next })}
                            options={[
                                { value: '5m', label: m['admin.ai.settings.keepAlive5m']() },
                                { value: '10m', label: m['admin.ai.settings.keepAlive10m']() },
                                { value: '30m', label: m['admin.ai.settings.keepAlive30m']() },
                                { value: '1h', label: m['admin.ai.settings.keepAlive1h']() },
                                { value: '4h', label: m['admin.ai.settings.keepAlive4h']() },
                                { value: '24h', label: m['admin.ai.settings.keepAlive24h']() },
                                { value: '-1', label: m['admin.ai.settings.keepAliveForever']() },
                            ]}
                        />
                    </FieldRow>

                    <ToggleGroup>
                        <ToggleRow
                            label={m['admin.ai.settings.warm']()}
                            desc={m['admin.ai.settings.warmHint']()}
                            checked={value.warm}
                            onChange={next => patch({ warm: next })}
                        />
                    </ToggleGroup>

                    {resident.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {m['admin.ai.settings.residentModels']()}
                            </span>
                            {resident.map((model, index) => {
                                const name = model.name ?? model.model ?? '—';
                                const vram = formatVram(model.size_vram);

                                return (
                                    <span
                                        key={`${name}-${index}`}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 font-mono text-xs text-[var(--color-ink-muted)]"
                                    >
                                        <Layers className="h-3 w-3 opacity-60" />
                                        {name}
                                        {vram && <span className="opacity-60">{vram}</span>}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </SectionCard>
            )}

            {capabilities.queue && (
                <SectionCard
                    icon={Gauge}
                    title={m['admin.ai.settings.queue']()}
                    desc={m['admin.ai.settings.queueHint']()}
                    right={
                        queue?.applies ? (
                            <span className="font-mono text-xs text-[var(--color-ink-faint)] tabular-nums">
                                {m['admin.ai.settings.slotsInUse']({
                                    used: String(queue.slots_in_use),
                                    total: String(queue.slots),
                                })}
                            </span>
                        ) : undefined
                    }
                >
                    <FieldGrid>
                        <FieldRow label={m['admin.ai.settings.slots']()} desc={m['admin.ai.settings.slotsHint']()}>
                            <Input
                                type="number"
                                min={0}
                                max={64}
                                value={value.slots}
                                onChange={event => patch({ slots: Number(event.target.value) })}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.ai.settings.perUser']()} desc={m['admin.ai.settings.perUserHint']()}>
                            <Input
                                type="number"
                                min={0}
                                max={16}
                                value={value.per_user}
                                onChange={event => patch({ per_user: Number(event.target.value) })}
                            />
                        </FieldRow>
                        <FieldRow
                            label={m['admin.ai.settings.queueDepth']()}
                            desc={m['admin.ai.settings.queueDepthHint']()}
                        >
                            <Input
                                type="number"
                                min={0}
                                max={500}
                                value={value.queue_depth}
                                onChange={event => patch({ queue_depth: Number(event.target.value) })}
                            />
                        </FieldRow>
                        <FieldRow label={m['admin.ai.settings.maxWait']()} desc={m['admin.ai.settings.maxWaitHint']()}>
                            <Input
                                type="number"
                                min={5}
                                max={600}
                                value={value.max_wait_seconds}
                                onChange={event => patch({ max_wait_seconds: Number(event.target.value) })}
                            />
                        </FieldRow>
                    </FieldGrid>
                </SectionCard>
            )}

            <IgnoredSettings items={ignored} />

            <SaveBar dirty={form.dirty} saving={form.saving} onDiscard={form.discard} />
        </form>
    );
}
