import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, KeyRound, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Panel } from '@/components/ui/Panel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { useFlags } from '@/state/flags';
import { firstError } from '@/lib/apiError';
import {
    getAiModels,
    getAiSettings,
    testAiConnection,
    updateAiSettings,
    type AiConnectionTest,
    type AiSettingsPayload,
} from '@/api/adminAi';

const MAX_PROMPT = 1000;

// Model names are proper nouns rendered verbatim (not catalogued), same as
// extension manifest copy. Shown only when live discovery has nothing.
const OPENAI_PRESETS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'];
const OLLAMA_PRESETS = ['qwen2.5:7b', 'qwen2.5:3b', 'phi3:mini', 'llama3.2:3b', 'mistral:7b'];

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
}: {
    title: string;
    description: string;
    checked: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border-strong)] p-3.5">
            <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{description}</p>
            </div>
            <Switch checked={checked} onChange={onChange} label={title} />
        </div>
    );
}

export function SettingsTab() {
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);

    const { data: settings, isLoading } = useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: getAiSettings });

    const [form, setForm] = useState<Required<Omit<AiSettingsPayload, 'enabled' | 'key'>> & { key: string }>({
        key: '',
        mode: 'openai',
        endpoint: '',
        model: '',
        max_tokens: 500,
        temperature: 0.3,
        keep_alive: '10m',
        warm: false,
        system_prompt: '',
        feature_server_assistant: true,
        feature_crash_analysis: true,
    });
    const [hydrated, setHydrated] = useState(false);
    const [confirmKeyDelete, setConfirmKeyDelete] = useState(false);
    const [testResult, setTestResult] = useState<AiConnectionTest | null>(null);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!settings || hydrated) return;
        setForm({
            key: '',
            mode: settings.mode || 'openai',
            endpoint: settings.endpoint || (settings.mode === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'),
            model: settings.model || '',
            max_tokens: settings.max_tokens ?? 500,
            temperature: settings.temperature ?? 0.3,
            keep_alive: settings.keep_alive || '10m',
            warm: settings.warm ?? false,
            system_prompt: settings.system_prompt || '',
            feature_server_assistant: settings.feature_server_assistant ?? true,
            feature_crash_analysis: settings.feature_crash_analysis ?? true,
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
                        },
                    },
                    site,
                );
            }
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const submit = () => {
        const payload: AiSettingsPayload = { ...form };
        if (!form.key.trim()) delete payload.key;
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

    const isOllama = form.mode === 'ollama';
    const presets = isOllama ? OLLAMA_PRESETS : OPENAI_PRESETS;
    const discovered = models.length > 0;

    return (
        <div className="space-y-3">
            {/* ── Provider ── */}
            <Panel title={m['admin.ai.settings.provider']()}>
                <div className="grid gap-4 md:grid-cols-3">
                    <Field label={m['admin.ai.settings.mode']()} hint={isOllama ? m['admin.ai.settings.modeOllamaHint']() : m['admin.ai.settings.modeOpenaiHint']()}>
                        <Select
                            value={form.mode}
                            onChange={v => patch('mode', v as 'openai' | 'ollama')}
                            options={[
                                { value: 'openai', label: m['admin.ai.providerOpenai']() },
                                { value: 'ollama', label: m['admin.ai.providerOllama']() },
                            ]}
                        />
                    </Field>
                    <Field label={m['admin.ai.settings.endpoint']()} hint={isOllama ? m['admin.ai.settings.endpointOllamaHint']() : m['admin.ai.settings.endpointOpenaiHint']()}>
                        <Input
                            value={form.endpoint}
                            onChange={e => patch('endpoint', e.target.value)}
                            placeholder={isOllama ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'}
                        />
                    </Field>
                    {isOllama ? (
                        <div className="flex items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2.5">
                            <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.ai.settings.noKeyNeeded']()}</p>
                        </div>
                    ) : (
                        <Field label={m['admin.ai.settings.apiKey']()}>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="password"
                                    value={form.key}
                                    onChange={e => patch('key', e.target.value)}
                                    placeholder={settings.key ? m['admin.ai.settings.keyKept']() : 'sk-…'}
                                    autoComplete="new-password"
                                />
                                {settings.key && (
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
            </Panel>

            {/* ── Model & performance ── */}
            <Panel title={m['admin.ai.settings.modelPerformance']()}>
                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <Field
                            label={m['admin.ai.settings.model']()}
                            hint={discovered ? m['admin.ai.settings.modelDiscoveredHint']() : m['admin.ai.settings.modelPresetHint']()}
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
                                        {discovered && <HardDrive className="h-3 w-3 opacity-60" />}
                                        {id}
                                        {size && <span className="opacity-60">{size}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        {modelsError && (
                            <p className="mt-2 text-xs text-[var(--color-warning)]">{m['admin.ai.settings.modelsUnavailable']()}</p>
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
