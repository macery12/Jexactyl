import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, KeyRound, RefreshCw, Trash2, TriangleAlert, Wifi } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Panel } from '@/components/ui/Panel';
import { FieldGrid } from '@/components/ui/editorChrome';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { useFlags } from '@/state/flags';
import { firstError } from '@/lib/apiError';
import {
    getAiInference,
    getAiModels,
    getAiSettings,
    testAiConnection,
    updateAiSettings,
    SELF_HOSTED_PROVIDERS,
    type AiConnectionTest,
    type AiProvider,
    type AiSettingsPayload,
} from '@/api/adminAi';

const MAX_PROMPT = 1000;

// Model names are proper nouns rendered verbatim (not catalogued), same as
// extension manifest copy. Shown only when live discovery has nothing.
const OPENAI_PRESETS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'];
const ANTHROPIC_PRESETS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
// Tool-capable local models. A model without tool support cannot run the agent
// at all, so the suggestions here are deliberately limited to ones that report
// it — the capability probe is what actually decides.
const OLLAMA_PRESETS = ['qwen3:8b', 'qwen2.5:7b', 'llama3.1:8b', 'mistral-nemo', 'llama3.3:70b'];

const DEFAULT_ENDPOINTS: Record<AiProvider, string> = {
    anthropic: 'https://api.anthropic.com/v1',
    openai: 'https://api.openai.com/v1',
    ollama: 'http://127.0.0.1:11434',
    openai_compatible: '',
};

const TEMP_STOPS: { at: number; label: () => string; hint: () => string }[] = [
    { at: 0.0, label: () => m['admin.ai.settings.tempDeterministic'](), hint: () => m['admin.ai.settings.tempDeterministicHint']() },
    { at: 0.3, label: () => m['admin.ai.settings.tempFocused'](), hint: () => m['admin.ai.settings.tempFocusedHint']() },
    { at: 0.7, label: () => m['admin.ai.settings.tempBalanced'](), hint: () => m['admin.ai.settings.tempBalancedHint']() },
    { at: 1.0, label: () => m['admin.ai.settings.tempCreative'](), hint: () => m['admin.ai.settings.tempCreativeHint']() },
];

function formatSize(bytes: number | null): string | null {
    if (!bytes) return null;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function SliderRow({
    label,
    display,
    min,
    max,
    step,
    value,
    onChange,
    lowLabel,
    highLabel,
}: {
    label: string;
    display: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    lowLabel: string;
    highLabel: string;
}) {
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-ink-muted)]">{label}</span>
                <span className="font-mono text-xs text-[var(--brand)]">{display}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-2)]"
                style={{ accentColor: 'var(--brand)' }}
            />
            <div className="mt-1 flex justify-between text-xs text-[var(--color-ink-faint)]">
                <span>{lowLabel}</span>
                <span>{highLabel}</span>
            </div>
        </div>
    );
}

function ToggleRow({
    title,
    description,
    checked,
    onChange,
    disabled = false,
}: {
    title: string;
    description: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div
            className={cn(
                'flex items-start justify-between gap-4 rounded-lg border border-[var(--color-border-strong)] p-3.5',
                disabled && 'opacity-55',
            )}
        >
            <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{description}</p>
            </div>
            <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
        </div>
    );
}

export function SettingsTab() {
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);

    const { data: settings, isLoading } = useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: getAiSettings });

    // Flat form, mapped to the nested payload on save: a single depth is far
    // easier to bind inputs against than three levels of partial objects.
    const [form, setForm] = useState({
        key: '',
        provider: 'ollama' as AiProvider,
        endpoint: '',
        model: '',
        model_agent: '',
        model_fast: '',
        max_tokens: 1024,
        temperature: 0.3,
        context_tokens: 0,
        keep_alive: '10m',
        warm: false,
        system_prompt: '',
        feature_server_assistant: true,
        feature_crash_analysis: true,

        agent_enabled: false,
        agent_admin_enabled: false,
        agent_max_steps: 12,
        agent_max_wall_seconds: 180,
        agent_tool_result_bytes: 12288,
        agent_max_tools: 15,

        concurrency_slots: 0,
        concurrency_queue_depth: 20,
        concurrency_max_wait_seconds: 120,
        concurrency_per_user: 1,

        budget_enforce: false,
        budget_monthly_tokens: 2_000_000,
    });
    const [hydrated, setHydrated] = useState(false);
    const [confirmKeyDelete, setConfirmKeyDelete] = useState(false);
    const [testResult, setTestResult] = useState<AiConnectionTest | null>(null);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!settings || hydrated) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setForm({
            key: '',
            provider: settings.provider,
            endpoint: settings.endpoint || DEFAULT_ENDPOINTS[settings.provider],
            model: settings.model || '',
            model_agent: settings.models?.agent ?? '',
            model_fast: settings.models?.fast ?? '',
            max_tokens: settings.max_tokens ?? 1024,
            temperature: settings.temperature ?? 0.3,
            // Zero means "let the model decide", which is what a null reads as.
            context_tokens: settings.context_tokens ?? 0,
            keep_alive: settings.keep_alive || '10m',
            warm: settings.warm ?? false,
            system_prompt: settings.system_prompt || '',
            feature_server_assistant: settings.feature_server_assistant ?? true,
            feature_crash_analysis: settings.feature_crash_analysis ?? true,

            agent_enabled: settings.agent?.enabled ?? false,
            agent_admin_enabled: settings.agent?.admin_enabled ?? false,
            agent_max_steps: settings.agent?.max_steps ?? 12,
            agent_max_wall_seconds: settings.agent?.max_wall_seconds ?? 180,
            agent_tool_result_bytes: settings.agent?.tool_result_bytes ?? 12288,
            agent_max_tools: settings.agent?.max_tools ?? 15,

            concurrency_slots: settings.concurrency?.slots ?? 0,
            concurrency_queue_depth: settings.concurrency?.queue_depth ?? 20,
            concurrency_max_wait_seconds: settings.concurrency?.max_wait_seconds ?? 120,
            concurrency_per_user: settings.concurrency?.per_user ?? 1,

            budget_enforce: settings.budget?.enforce ?? false,
            budget_monthly_tokens: settings.budget?.monthly_tokens ?? 2_000_000,
        });
        setHydrated(true);
    }, [settings, hydrated]);

    const patch = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
        setForm(prev => ({ ...prev, [key]: value }));

    // Installed-model discovery (Ollama /api/tags or the provider's /models).
    const {
        data: models = [],
        isFetching: modelsFetching,
        refetch: refetchModels,
        isError: modelsError,
    } = useQuery({
        queryKey: ['admin', 'ai', 'models'],
        queryFn: () => getAiModels(false),
        retry: false,
        staleTime: 300_000,
    });

    const save = useMutation({
        mutationFn: (payload: AiSettingsPayload) => updateAiSettings(payload),
        onSuccess: (_data, payload) => {
            push({ type: 'success', message: m['admin.ai.settings.saved']() });
            void queryClient.invalidateQueries({ queryKey: ['admin', 'ai'] });
            // Keep the live flags store in step so nav gating updates without a reload.
            const { everest, site, set } = useFlags.getState();
            if (everest) {
                set(
                    {
                        ...everest,
                        ai: {
                            ...everest.ai,
                            feature_server_assistant: payload.feature_server_assistant ?? everest.ai.feature_server_assistant,
                            feature_crash_analysis: payload.feature_crash_analysis ?? everest.ai.feature_crash_analysis,
                            feature_agent: payload.agent?.enabled ?? everest.ai.feature_agent,
                        },
                    },
                    site,
                );
            }
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const submit = () => {
        const payload: AiSettingsPayload = {
            provider: form.provider,
            endpoint: form.endpoint,
            model: form.model,
            models: { agent: form.model_agent, fast: form.model_fast },
            max_tokens: form.max_tokens,
            temperature: form.temperature,
            // Sent as null rather than 0 so the backend reads it as "unset"
            // and falls back to the model's own reported window.
            context_tokens: form.context_tokens > 0 ? form.context_tokens : null,
            keep_alive: form.keep_alive,
            warm: form.warm,
            system_prompt: form.system_prompt,
            feature_server_assistant: form.feature_server_assistant,
            feature_crash_analysis: form.feature_crash_analysis,
            agent: {
                enabled: form.agent_enabled,
                admin_enabled: form.agent_admin_enabled,
                max_steps: form.agent_max_steps,
                max_wall_seconds: form.agent_max_wall_seconds,
                tool_result_bytes: form.agent_tool_result_bytes,
                max_tools: form.agent_max_tools,
            },
            concurrency: {
                slots: form.concurrency_slots > 0 ? form.concurrency_slots : null,
                queue_depth: form.concurrency_queue_depth,
                max_wait_seconds: form.concurrency_max_wait_seconds,
                per_user: form.concurrency_per_user,
            },
            budget: {
                enforce: form.budget_enforce,
                monthly_tokens: form.budget_monthly_tokens,
            },
        };

        if (form.key.trim()) payload.key = form.key;

        save.mutate(payload);
    };

    const removeKey = useMutation({
        mutationFn: () => updateAiSettings({ key: '' }),
        onSuccess: () => {
            setConfirmKeyDelete(false);
            push({ type: 'success', message: m['admin.ai.settings.keyRemoved']() });
            void queryClient.invalidateQueries({ queryKey: ['admin', 'ai', 'settings'] });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const runTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            setTestResult(await testAiConnection(true));
        } catch {
            setTestResult({ status: 'error', message: m['common.states.genericError']() });
        } finally {
            setTesting(false);
        }
    };

    // Probes the configured agent model. Kept out of the save path: it is
    // advisory, and a slow or unreachable endpoint must not block editing.
    const capabilities = useQuery({
        queryKey: ['admin', 'ai', 'inference'],
        queryFn: getAiInference,
        retry: false,
        staleTime: 60_000,
    });

    const tempInfo = useMemo(
        () => TEMP_STOPS.reduce((a, b) => (Math.abs(b.at - form.temperature) < Math.abs(a.at - form.temperature) ? b : a)),
        [form.temperature],
    );

    if (isLoading || !settings) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const selfHosted = SELF_HOSTED_PROVIDERS.includes(form.provider);
    const isOllama = form.provider === 'ollama';
    // Saving a different provider discards the stored endpoint and key, so the
    // "key on file" affordances below must stop claiming one is kept.
    const providerChanged = form.provider !== settings.provider;
    const presets =
        form.provider === 'anthropic' ? ANTHROPIC_PRESETS : selfHosted ? OLLAMA_PRESETS : OPENAI_PRESETS;
    const discovered = models.length > 0;

    // The agent cannot run on a model that does not report tool support, so
    // saying so here — beside the model field — is worth more than a failure at
    // the moment a user first tries it.
    const toolsUnsupported = capabilities.data?.capabilities?.supports_tools === false;

    return (
        <div className="space-y-3">
            {/* ── Provider ── */}
            <Panel title={m['admin.ai.settings.provider']()}>
                <div className="grid gap-4 md:grid-cols-3">
                    <Field
                        label={m['admin.ai.settings.providerLabel']()}
                        hint={selfHosted ? m['admin.ai.settings.modeOllamaHint']() : m['admin.ai.settings.modeOpenaiHint']()}
                    >
                        <Select
                            value={form.provider}
                            onChange={v => {
                                const next = v as AiProvider;
                                setForm(prev => ({
                                    ...prev,
                                    provider: next,
                                    // The endpoint and key are a single slot
                                    // shared by every provider, not one slot
                                    // each, so the previous provider's values
                                    // cannot carry over: a LAN Ollama address
                                    // is not a valid Anthropic endpoint, and
                                    // its key would be rejected there. The
                                    // backend clears the stored pair to match.
                                    endpoint: DEFAULT_ENDPOINTS[next],
                                    key: '',
                                }));
                            }}
                            options={[
                                { value: 'anthropic', label: m['admin.ai.providerAnthropic']() },
                                { value: 'openai', label: m['admin.ai.providerOpenai']() },
                                { value: 'ollama', label: m['admin.ai.providerOllama']() },
                                { value: 'openai_compatible', label: m['admin.ai.providerCompatible']() },
                            ]}
                        />
                    </Field>
                    <Field label={m['admin.ai.settings.endpoint']()} hint={selfHosted ? m['admin.ai.settings.endpointOllamaHint']() : m['admin.ai.settings.endpointOpenaiHint']()}>
                        <Input
                            value={form.endpoint}
                            onChange={e => patch('endpoint', e.target.value)}
                            placeholder={DEFAULT_ENDPOINTS[form.provider] || 'https://…'}
                        />
                    </Field>
                    {isOllama ? (
                        <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2.5">
                            <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.noKeyNeeded']()}</p>
                        </div>
                    ) : (
                        <Field label={m['admin.ai.settings.apiKey']()}>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="password"
                                    value={form.key}
                                    onChange={e => patch('key', e.target.value)}
                                    placeholder={settings.key && !providerChanged ? m['admin.ai.settings.keyKept']() : 'sk-…'}
                                    autoComplete="new-password"
                                />
                                {settings.key && !providerChanged && (
                                    <Button
                                        variant="danger"
                                        size="icon"
                                        title={m['admin.ai.settings.removeKey']()}
                                        onClick={() => setConfirmKeyDelete(true)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </Field>
                    )}
                </div>

                {providerChanged && (
                    <div className="mt-3 flex gap-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                        <p className="text-xs text-[var(--color-ink-muted)]">
                            {m['admin.ai.settings.providerSwitch']({ provider: settings.provider })}
                        </p>
                    </div>
                )}
            </Panel>

            {/* ── Model & performance ── */}
            <Panel title={m['admin.ai.settings.modelPerformance']()}>
                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <Field
                            label={m['admin.ai.settings.model']()}
                            hint={
                                !discovered
                                    ? m['admin.ai.settings.modelPresetHint']()
                                    : selfHosted
                                      ? m['admin.ai.settings.modelDiscoveredHint']()
                                      : m['admin.ai.settings.modelAvailableHint']()
                            }
                        >
                            <div className="flex items-center gap-2">
                                <Input value={form.model} onChange={e => patch('model', e.target.value)} className="font-mono" />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    title={m['admin.ai.settings.refreshModels']()}
                                    onClick={() => void refetchModels()}
                                    disabled={modelsFetching}
                                >
                                    <RefreshCw className={cn('h-4 w-4', modelsFetching && 'animate-spin')} />
                                </Button>
                            </div>
                        </Field>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {(discovered ? models.map(mod => mod.id) : presets).map(id => {
                                const size = discovered ? formatSize(models.find(mod => mod.id === id)?.size ?? null) : null;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => patch('model', id)}
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors',
                                            form.model === id
                                                ? 'border-[var(--brand)]/60 bg-[var(--brand-soft)] text-[var(--brand)]'
                                                : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:border-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
                                        )}
                                    >
                                        {/* A disk icon only means something for a model
                                            that occupies disk here; a hosted model has
                                            no local footprint and no size to report. */}
                                        {selfHosted && discovered && <HardDrive className="h-3 w-3 opacity-60" />}
                                        {id}
                                        {size && <span className="opacity-60">{size}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        {modelsError && (
                            <p className="mt-2 text-xs text-[var(--color-warning)]">{m['admin.ai.settings.modelsUnavailable']()}</p>
                        )}

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <Field
                                label={m['admin.ai.settings.modelAgent']()}
                                hint={m['admin.ai.settings.modelAgentHint']()}
                            >
                                <Input
                                    value={form.model_agent}
                                    onChange={e => patch('model_agent', e.target.value)}
                                    placeholder={form.model || m['admin.ai.settings.modelInherit']()}
                                    className="font-mono text-xs"
                                />
                            </Field>
                            <Field
                                label={m['admin.ai.settings.modelFast']()}
                                hint={m['admin.ai.settings.modelFastHint']()}
                            >
                                <Input
                                    value={form.model_fast}
                                    onChange={e => patch('model_fast', e.target.value)}
                                    placeholder={form.model || m['admin.ai.settings.modelInherit']()}
                                    className="font-mono text-xs"
                                />
                            </Field>
                        </div>

                        {toolsUnsupported && (
                            <div className="mt-3 flex gap-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5">
                                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                                <p className="text-xs text-[var(--color-ink-muted)]">
                                    {capabilities.data?.capabilities?.warnings[0] ??
                                        m['admin.ai.settings.noToolSupport']()}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-5">
                        <SliderRow
                            label={m['admin.ai.settings.maxTokens']()}
                            display={String(form.max_tokens)}
                            min={50}
                            max={4000}
                            step={50}
                            value={form.max_tokens}
                            onChange={v => patch('max_tokens', v)}
                            lowLabel={m['admin.ai.settings.maxTokensLow']()}
                            highLabel={m['admin.ai.settings.maxTokensHigh']()}
                        />
                        <div>
                            <SliderRow
                                label={m['admin.ai.settings.temperature']()}
                                display={form.temperature.toFixed(2)}
                                min={0}
                                max={1}
                                step={0.05}
                                value={form.temperature}
                                onChange={v => patch('temperature', v)}
                                lowLabel={m['admin.ai.settings.tempDeterministic']()}
                                highLabel={m['admin.ai.settings.tempCreative']()}
                            />
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-[var(--brand)]">
                                    {tempInfo.label()}
                                </span>
                                <span className="text-xs text-[var(--color-ink-faint)]">{tempInfo.hint()}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Panel>

            {/* ── Ollama performance (keep-warm) ── */}
            {isOllama && (
                <Panel title={m['admin.ai.settings.ollamaPerformance']()}>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label={m['admin.ai.settings.keepAlive']()} hint={m['admin.ai.settings.keepAliveHint']()}>
                            <Select
                                value={form.keep_alive}
                                onChange={v => patch('keep_alive', v)}
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
                        </Field>
                        <ToggleRow
                            title={m['admin.ai.settings.warm']()}
                            description={m['admin.ai.settings.warmHint']()}
                            checked={form.warm}
                            onChange={v => patch('warm', v)}
                        />
                    </div>
                </Panel>
            )}

            {/* ── Agent ── */}
            <Panel title={m['admin.ai.settings.agent']()}>
                <div className="space-y-3">
                    <ToggleRow
                        title={m['admin.ai.settings.agentEnabled']()}
                        description={m['admin.ai.settings.agentEnabledHint']()}
                        checked={form.agent_enabled}
                        onChange={v => patch('agent_enabled', v)}
                    />

                    <ToggleRow
                        title={m['admin.ai.settings.adminAgentEnabled']()}
                        description={m['admin.ai.settings.adminAgentEnabledHint']()}
                        checked={form.agent_admin_enabled}
                        onChange={v => patch('agent_admin_enabled', v)}
                        disabled={!form.agent_enabled}
                    />

                    <FieldGrid>
                        <Field label={m['admin.ai.settings.maxSteps']()} hint={m['admin.ai.settings.maxStepsHint']()}>
                            <Input
                                type="number"
                                min={1}
                                max={50}
                                value={form.agent_max_steps}
                                onChange={e => patch('agent_max_steps', Number(e.target.value))}
                            />
                        </Field>
                        <Field label={m['admin.ai.settings.maxWall']()} hint={m['admin.ai.settings.maxWallHint']()}>
                            <Input
                                type="number"
                                min={15}
                                max={900}
                                value={form.agent_max_wall_seconds}
                                onChange={e => patch('agent_max_wall_seconds', Number(e.target.value))}
                            />
                        </Field>
                        <Field label={m['admin.ai.settings.maxTools']()} hint={m['admin.ai.settings.maxToolsHint']()}>
                            <Input
                                type="number"
                                min={4}
                                max={64}
                                value={form.agent_max_tools}
                                onChange={e => patch('agent_max_tools', Number(e.target.value))}
                            />
                        </Field>
                        <Field
                            label={m['admin.ai.settings.toolResultBytes']()}
                            hint={m['admin.ai.settings.toolResultBytesHint']()}
                        >
                            <Input
                                type="number"
                                min={1024}
                                max={131072}
                                step={1024}
                                value={form.agent_tool_result_bytes}
                                onChange={e => patch('agent_tool_result_bytes', Number(e.target.value))}
                            />
                        </Field>
                    </FieldGrid>
                </div>
            </Panel>

            {/* ── Inference queue (self-hosted only) ── */}
            {selfHosted && (
                <Panel title={m['admin.ai.settings.queue']()}>
                    <p className="mb-3 text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.queueHint']()}</p>
                    <FieldGrid>
                        <Field label={m['admin.ai.settings.slots']()} hint={m['admin.ai.settings.slotsHint']()}>
                            <Input
                                type="number"
                                min={0}
                                max={64}
                                value={form.concurrency_slots}
                                onChange={e => patch('concurrency_slots', Number(e.target.value))}
                            />
                        </Field>
                        <Field label={m['admin.ai.settings.perUser']()} hint={m['admin.ai.settings.perUserHint']()}>
                            <Input
                                type="number"
                                min={0}
                                max={16}
                                value={form.concurrency_per_user}
                                onChange={e => patch('concurrency_per_user', Number(e.target.value))}
                            />
                        </Field>
                        <Field
                            label={m['admin.ai.settings.queueDepth']()}
                            hint={m['admin.ai.settings.queueDepthHint']()}
                        >
                            <Input
                                type="number"
                                min={0}
                                max={500}
                                value={form.concurrency_queue_depth}
                                onChange={e => patch('concurrency_queue_depth', Number(e.target.value))}
                            />
                        </Field>
                        <Field label={m['admin.ai.settings.maxWait']()} hint={m['admin.ai.settings.maxWaitHint']()}>
                            <Input
                                type="number"
                                min={5}
                                max={600}
                                value={form.concurrency_max_wait_seconds}
                                onChange={e => patch('concurrency_max_wait_seconds', Number(e.target.value))}
                            />
                        </Field>
                        <Field
                            label={m['admin.ai.settings.contextTokens']()}
                            hint={m['admin.ai.settings.contextTokensHint']()}
                        >
                            <Input
                                type="number"
                                min={0}
                                step={1024}
                                value={form.context_tokens}
                                onChange={e => patch('context_tokens', Number(e.target.value))}
                            />
                        </Field>
                    </FieldGrid>
                </Panel>
            )}

            {/* ── Budget ── */}
            <Panel title={m['admin.ai.settings.budget']()}>
                <div className="grid gap-3 md:grid-cols-2">
                    <ToggleRow
                        title={m['admin.ai.settings.budgetEnforce']()}
                        description={m['admin.ai.settings.budgetEnforceHint']()}
                        checked={form.budget_enforce}
                        onChange={v => patch('budget_enforce', v)}
                    />
                    <Field
                        label={m['admin.ai.settings.monthlyTokens']()}
                        hint={m['admin.ai.settings.monthlyTokensHint']()}
                    >
                        <Input
                            type="number"
                            min={0}
                            step={100_000}
                            value={form.budget_monthly_tokens}
                            onChange={e => patch('budget_monthly_tokens', Number(e.target.value))}
                        />
                    </Field>
                </div>
            </Panel>

            {/* ── Access ── */}
            <Panel title={m['admin.ai.settings.access']()}>
                <div className="grid gap-3 md:grid-cols-2">
                    <ToggleRow
                        title={m['admin.ai.settings.serverAssistant']()}
                        description={m['admin.ai.settings.serverAssistantHint']()}
                        checked={form.feature_server_assistant}
                        onChange={v => patch('feature_server_assistant', v)}
                    />
                    <ToggleRow
                        title={m['admin.ai.settings.crashAnalysis']()}
                        description={m['admin.ai.settings.crashAnalysisHint']()}
                        checked={form.feature_crash_analysis}
                        onChange={v => patch('feature_crash_analysis', v)}
                    />
                </div>
                <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.adminsAlways']()}</p>
            </Panel>

            {/* ── System prompt ── */}
            <Panel
                title={m['admin.ai.settings.systemPrompt']()}
                right={
                    <span
                        className={cn(
                            'text-xs tabular-nums',
                            form.system_prompt.length > MAX_PROMPT ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-faint)]',
                        )}
                    >
                        {form.system_prompt.length} / {MAX_PROMPT}
                    </span>
                }
            >
                <p className="mb-2 text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.systemPromptHint']()}</p>
                <Textarea
                    rows={5}
                    value={form.system_prompt}
                    onChange={e => patch('system_prompt', e.target.value)}
                />
            </Panel>

            {/* ── Save bar ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.effectNote']()}</p>
                <div className="flex items-center gap-3">
                    {testResult && (
                        <span
                            className={cn(
                                'text-xs font-medium',
                                testResult.status === 'ok' ? 'text-[var(--color-accent)]' : 'text-[var(--color-danger)]',
                            )}
                        >
                            {testResult.status === 'ok'
                                ? m['admin.ai.overview.connected']({ latency: String(testResult.latency_ms ?? '?') })
                                : testResult.message}
                        </span>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => void runTest()} disabled={testing}>
                        <Wifi className="h-3.5 w-3.5" />
                        {testing ? m['admin.ai.settings.testing']() : m['admin.ai.settings.testConnection']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={save.isPending || form.system_prompt.length > MAX_PROMPT}>
                        {save.isPending ? m['common.states.saving']() : m['common.actions.saveChanges']()}
                    </Button>
                </div>
            </div>

            <ConfirmDialog
                open={confirmKeyDelete}
                onClose={() => setConfirmKeyDelete(false)}
                title={m['admin.ai.settings.removeKeyTitle']()}
                body={m['admin.ai.settings.removeKeyBody']()}
                confirmLabel={m['common.actions.remove']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={removeKey.isPending}
                onConfirm={() => removeKey.mutate()}
            />

            <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
                <KeyRound className="h-3.5 w-3.5" />
                {m['admin.ai.settings.footerNote']()}
            </div>
        </div>
    );
}
