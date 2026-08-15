import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, HardDrive, KeyRound, Plug, RefreshCw, Trash2, TriangleAlert, Wifi } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FieldGrid, FieldRow, SaveBar, SectionCard } from '@/components/ui/editorChrome';
import { SettingNotice } from '../SettingNotice';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getAiInference,
    getAiModels,
    testAiConnection,
    updateAiSettings,
    type AiConnectionTest,
    type AiProvider,
} from '@/api/adminAi';
import { DEFAULT_ENDPOINTS } from '../capabilities';
import { AI_INFERENCE_KEY, AI_SETTINGS_KEY, useAiCapabilities, useAiSettingsForm } from '../useAiSettingsForm';

function formatSize(bytes: number | null): string | null {
    if (!bytes) return null;

    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Where the panel sends its inference, and what it asks for. Everything on this
// page is one decision — an endpoint, a credential, a model — which is why it
// is worth a page rather than the top third of a long form.
export default function ProviderPage() {
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);
    const [confirmKeyDelete, setConfirmKeyDelete] = useState(false);
    const [testResult, setTestResult] = useState<AiConnectionTest | null>(null);
    const [testing, setTesting] = useState(false);

    const form = useAiSettingsForm(
        settings => ({
            provider: settings.provider,
            endpoint: settings.endpoint || DEFAULT_ENDPOINTS[settings.provider],
            // Never returned by the API — a blank draft means "leave whatever is
            // stored alone", and only a typed value is ever sent.
            key: '',
            model: settings.model || '',
            model_agent: settings.models?.agent ?? '',
            model_fast: settings.models?.fast ?? '',
        }),
        value => ({
            provider: value.provider,
            endpoint: value.endpoint,
            model: value.model,
            models: { agent: value.model_agent, fast: value.model_fast },
            ...(value.key.trim() ? { key: value.key } : {}),
        }),
    );

    const { settings, value, patch } = form;
    const capabilities = useAiCapabilities(value?.provider);

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

    // Same key as useAiCapabilities, so this shares that request rather than
    // making a second one.
    const { data: inference } = useQuery({
        queryKey: AI_INFERENCE_KEY,
        queryFn: getAiInference,
        retry: false,
        staleTime: 60_000,
    });

    const removeKey = useMutation({
        mutationFn: () => updateAiSettings({ key: '' }),
        onSuccess: () => {
            setConfirmKeyDelete(false);
            push({ type: 'success', message: m['admin.ai.settings.keyRemoved']() });
            void queryClient.invalidateQueries({ queryKey: AI_SETTINGS_KEY });
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

    if (form.isLoading || !value || !settings) {
        return (
            <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    // Saving a different provider discards the stored endpoint and key, so the
    // "key on file" affordances below must stop claiming one is kept.
    const providerChanged = value.provider !== settings.provider;
    const discovered = models.length > 0;

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={event => {
                event.preventDefault();
                form.submit();
            }}
        >
            <SectionCard
                icon={Plug}
                title={m['admin.ai.settings.provider']()}
                desc={m['admin.ai.pages.providerDesc']()}
                right={
                    <div className="flex items-center gap-3">
                        {testResult && (
                            <span
                                className={cn(
                                    'text-xs font-medium',
                                    testResult.status === 'ok'
                                        ? 'text-[var(--color-accent)]'
                                        : 'text-[var(--color-danger)]',
                                )}
                            >
                                {testResult.status === 'ok'
                                    ? m['admin.ai.overview.connected']({ latency: String(testResult.latency_ms ?? '?') })
                                    : testResult.message}
                            </span>
                        )}
                        <Button type="button" variant="secondary" size="sm" onClick={() => void runTest()} disabled={testing}>
                            <Wifi className="h-3.5 w-3.5" />
                            {testing ? m['admin.ai.settings.testing']() : m['admin.ai.settings.testConnection']()}
                        </Button>
                    </div>
                }
            >
                <FieldGrid>
                    <FieldRow
                        label={m['admin.ai.settings.providerLabel']()}
                        desc={
                            capabilities.selfHosted
                                ? m['admin.ai.settings.modeOllamaHint']()
                                : m['admin.ai.settings.modeOpenaiHint']()
                        }
                    >
                        <Select
                            value={value.provider}
                            onChange={next =>
                                // The endpoint and key are a single slot shared
                                // by every provider, not one slot each, so the
                                // previous provider's values cannot carry over:
                                // a LAN Ollama address is not a valid Anthropic
                                // endpoint, and its key would be rejected there.
                                // The backend clears the stored pair to match.
                                patch({ provider: next as AiProvider, endpoint: DEFAULT_ENDPOINTS[next as AiProvider], key: '' })
                            }
                            options={[
                                { value: 'anthropic', label: m['admin.ai.providerAnthropic']() },
                                { value: 'openai', label: m['admin.ai.providerOpenai']() },
                                { value: 'ollama', label: m['admin.ai.providerOllama']() },
                                { value: 'openai_compatible', label: m['admin.ai.providerCompatible']() },
                            ]}
                        />
                    </FieldRow>

                    <FieldRow
                        label={m['admin.ai.settings.endpoint']()}
                        desc={
                            capabilities.selfHosted
                                ? m['admin.ai.settings.endpointOllamaHint']()
                                : m['admin.ai.settings.endpointOpenaiHint']()
                        }
                    >
                        <Input
                            value={value.endpoint}
                            onChange={event => patch({ endpoint: event.target.value })}
                            placeholder={DEFAULT_ENDPOINTS[value.provider] || 'https://…'}
                        />
                    </FieldRow>

                    {capabilities.shimmedOllama && (
                        <SettingNotice title={m['admin.ai.settings.shimWarnTitle']()}>
                            {m['admin.ai.settings.shimWarnBody']()}
                        </SettingNotice>
                    )}

                    {capabilities.apiKey ? (
                        <FieldRow label={m['admin.ai.settings.apiKey']()}>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="password"
                                    value={value.key}
                                    onChange={event => patch({ key: event.target.value })}
                                    placeholder={
                                        settings.key && !providerChanged ? m['admin.ai.settings.keyKept']() : 'sk-…'
                                    }
                                    autoComplete="new-password"
                                />
                                {settings.key && !providerChanged && (
                                    <Button
                                        type="button"
                                        variant="danger"
                                        size="icon"
                                        title={m['admin.ai.settings.removeKey']()}
                                        onClick={() => setConfirmKeyDelete(true)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </FieldRow>
                    ) : (
                        <FieldRow label={m['admin.ai.settings.apiKey']()}>
                            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2.5 text-xs text-[var(--color-ink-faint)]">
                                {m['admin.ai.settings.noKeyNeeded']()}
                            </p>
                        </FieldRow>
                    )}
                </FieldGrid>

                {providerChanged && (
                    <div className="flex gap-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                        <p className="text-xs text-[var(--color-ink-muted)]">
                            {m['admin.ai.settings.providerSwitch']({ provider: settings.provider })}
                        </p>
                    </div>
                )}
            </SectionCard>

            <SectionCard icon={Cpu} title={m['admin.ai.settings.model']()} desc={m['admin.ai.pages.modelDesc']()}>
                <FieldRow
                    label={m['admin.ai.settings.model']()}
                    desc={
                        !discovered
                            ? m['admin.ai.settings.modelPresetHint']()
                            : capabilities.selfHosted
                              ? m['admin.ai.settings.modelDiscoveredHint']()
                              : m['admin.ai.settings.modelAvailableHint']()
                    }
                >
                    <div className="flex items-center gap-2">
                        <Input
                            value={value.model}
                            onChange={event => patch({ model: event.target.value })}
                            className="font-mono"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title={m['admin.ai.settings.refreshModels']()}
                            onClick={() => void refetchModels()}
                            disabled={modelsFetching}
                        >
                            <RefreshCw className={cn('h-4 w-4', modelsFetching && 'animate-spin')} />
                        </Button>
                    </div>
                </FieldRow>

                <div className="flex flex-wrap gap-1.5">
                    {(discovered ? models.map(model => model.id) : capabilities.presets).map(id => {
                        const size = discovered ? formatSize(models.find(model => model.id === id)?.size ?? null) : null;

                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => patch({ model: id })}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors',
                                    value.model === id
                                        ? 'border-[var(--brand)]/60 bg-[var(--brand-soft)] text-[var(--brand)]'
                                        : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:border-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
                                )}
                            >
                                {/* A disk icon only means something for a model that
                                    occupies disk here; a hosted model has no local
                                    footprint and no size to report. */}
                                {capabilities.selfHosted && discovered && <HardDrive className="h-3 w-3 opacity-60" />}
                                {id}
                                {size && <span className="opacity-60">{size}</span>}
                            </button>
                        );
                    })}
                </div>

                {modelsError && (
                    <p className="text-xs text-[var(--color-warning)]">{m['admin.ai.settings.modelsUnavailable']()}</p>
                )}

                <FieldGrid>
                    <FieldRow label={m['admin.ai.settings.modelAgent']()} desc={m['admin.ai.settings.modelAgentHint']()}>
                        <Input
                            value={value.model_agent}
                            onChange={event => patch({ model_agent: event.target.value })}
                            placeholder={value.model || m['admin.ai.settings.modelInherit']()}
                            className="font-mono text-xs"
                        />
                    </FieldRow>
                    <FieldRow label={m['admin.ai.settings.modelFast']()} desc={m['admin.ai.settings.modelFastHint']()}>
                        <Input
                            value={value.model_fast}
                            onChange={event => patch({ model_fast: event.target.value })}
                            placeholder={value.model || m['admin.ai.settings.modelInherit']()}
                            className="font-mono text-xs"
                        />
                    </FieldRow>
                </FieldGrid>

                {/* The agent cannot run on a model that does not report tool
                    support, so saying so beside the model field is worth more
                    than a failure the first time someone tries it. */}
                {inference?.capabilities?.supports_tools === false && (
                    <div className="flex gap-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                        <p className="text-xs text-[var(--color-ink-muted)]">
                            {inference.capabilities.warnings[0] ?? m['admin.ai.settings.noToolSupport']()}
                        </p>
                    </div>
                )}
            </SectionCard>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-faint)]">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <span>{m['admin.ai.settings.footerNote']()}</span>
                <span>{m['admin.ai.settings.effectNote']()}</span>
            </div>

            <SaveBar dirty={form.dirty} saving={form.saving} onDiscard={form.discard} />

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
        </form>
    );
}
