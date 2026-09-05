import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Cpu, ExternalLink, HardDrive, KeyRound, Plug, RefreshCw, Trash2, TriangleAlert, Wifi, Wrench } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FieldGrid, FieldRow, SaveBar, SectionCard } from '@/components/ui/editorChrome';
import { SettingNotice } from '../SettingNotice';
import { AiLoadError } from '../LoadError';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getAiInference,
    getAiModels,
    testAiConnection,
    testAiToolCalling,
    updateAiSettings,
    type AiConnectionTest,
    type AiProvider,
    type AiToolCallingTest,
} from '@/api/adminAi';
import { DEFAULT_ENDPOINTS } from '../capabilities';
import { AI_INFERENCE_KEY, AI_SETTINGS_KEY, useAiCapabilities, useAiSettingsForm } from '../useAiSettingsForm';

const LOCAL_PROVIDER_CHOICE = 'local';

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
    const [toolTestResult, setToolTestResult] = useState<AiToolCallingTest | null>(null);
    const [testing, setTesting] = useState(false);

    const form = useAiSettingsForm(
        settings => ({
            provider: settings.provider,
            endpoint: settings.endpoint || DEFAULT_ENDPOINTS[settings.provider],
            // Never returned by the API — a blank draft means "leave whatever is
            // stored alone", and only a typed value is ever sent.
            key: '',
            model: settings.model || '',
        }),
        value => ({
            provider: value.provider,
            endpoint: value.endpoint,
            model: value.model,
            ...(value.key.trim() ? { key: value.key } : {}),
        }),
    );

    const { settings, value, patch: patchDraft } = form;
    const capabilities = useAiCapabilities(value?.provider);
    const modelsKey = ['admin', 'ai', 'models'] as const;

    const {
        data: models = [],
        isFetching: modelsFetching,
        isError: modelsQueryError,
        error: modelsQueryFailure,
    } = useQuery({
        queryKey: modelsKey,
        queryFn: () => getAiModels(false),
        retry: false,
        staleTime: 300_000,
    });

    const refreshModels = useMutation({
        mutationFn: () => getAiModels(true),
        onSuccess: fresh => queryClient.setQueryData(modelsKey, fresh),
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

    const testTools = useMutation({
        mutationFn: testAiToolCalling,
        onSuccess: result => {
            setToolTestResult(result);
            if (result.status !== 'error') {
                void queryClient.invalidateQueries({ queryKey: AI_INFERENCE_KEY });
            }
        },
        onError: err => {
            setToolTestResult({
                status: 'error',
                message: firstError(err) ?? m['common.states.genericError'](),
            });
        },
    });

    // A connection result belongs to the saved endpoint. Clear it as soon as
    // the draft changes so "Connected" can never describe the old provider.
    const patch = (partial: Parameters<typeof patchDraft>[0]) => {
        setTestResult(null);
        setToolTestResult(null);
        patchDraft(partial);
    };

    const runTest = async () => {
        if (form.dirty) return;

        setTesting(true);
        setTestResult(null);
        try {
            setTestResult(await testAiConnection(true));
        } catch (error) {
            setTestResult({
                status: 'error',
                message: firstError(error) ?? m['common.states.genericError'](),
            });
        } finally {
            setTesting(false);
        }
    };

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

    // Saving a different provider discards the stored endpoint and key, so the
    // "key on file" affordances below must stop claiming one is kept.
    const providerChanged = value.provider !== settings.provider;
    const localProvider = value.provider === 'ollama' || value.provider === 'openai_compatible';
    const probeOutdated = form.dirty;
    const discovered = !probeOutdated && models.length > 0;
    const modelsRefreshing = modelsFetching || refreshModels.isPending;
    const modelsError = modelsQueryError || refreshModels.isError;
    const modelsFailure = refreshModels.error ?? modelsQueryFailure;
    const testedCapabilities = !probeOutdated
        && inference?.capabilities?.model === settings.model
        ? inference.capabilities
        : null;
    const toolTestStatus = toolTestResult?.status
        ?? (testedCapabilities?.tool_support_verified
            ? testedCapabilities.supports_tools ? 'supported' : 'unsupported'
            : null);
    const toolTestModel = toolTestResult?.model ?? testedCapabilities?.model ?? value.model;

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
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            title={probeOutdated ? m['admin.ai.settings.saveBeforeProbe']() : undefined}
                            onClick={() => void runTest()}
                            disabled={testing || probeOutdated}
                        >
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
                            localProvider
                                ? m['admin.ai.settings.modeLocalHint']()
                                : value.provider === 'openrouter'
                                  ? m['admin.ai.settings.modeOpenrouterHint']()
                                  : value.provider === 'anthropic'
                                    ? m['admin.ai.settings.modeAnthropicHint']()
                                    : m['admin.ai.settings.modeOpenaiHint']()
                        }
                    >
                        <Select
                            value={localProvider ? LOCAL_PROVIDER_CHOICE : value.provider}
                            onChange={next => {
                                const provider = next === LOCAL_PROVIDER_CHOICE
                                    ? 'ollama'
                                    : next as AiProvider;

                                // The endpoint and key are a single slot shared
                                // by every provider, not one slot each, so the
                                // previous provider's values cannot carry over:
                                // a LAN Ollama address is not a valid Anthropic
                                // endpoint, and its key would be rejected there.
                                // The backend clears the stored pair to match.
                                patch({
                                    provider,
                                    endpoint: DEFAULT_ENDPOINTS[provider],
                                    key: '',
                                    ...(provider === 'openrouter' ? { model: 'openrouter/free' } : {}),
                                });
                            }}
                            options={[
                                { value: 'openai', label: m['admin.ai.providerOpenai']() },
                                { value: 'anthropic', label: m['admin.ai.providerAnthropic']() },
                                { value: 'openrouter', label: m['admin.ai.providerOpenrouter']() },
                                { value: LOCAL_PROVIDER_CHOICE, label: m['admin.ai.providerLocal']() },
                            ]}
                        />
                    </FieldRow>

                    {localProvider && (
                        <FieldRow
                            label={m['admin.ai.settings.localProtocol']()}
                            desc={
                                value.provider === 'ollama'
                                    ? m['admin.ai.settings.modeOllamaHint']()
                                    : m['admin.ai.settings.modeCompatibleHint']()
                            }
                        >
                            <Select
                                value={value.provider}
                                onChange={next => {
                                    const provider = next as AiProvider;

                                    patch({
                                        provider,
                                        endpoint: DEFAULT_ENDPOINTS[provider],
                                        key: '',
                                    });
                                }}
                                options={[
                                    { value: 'ollama', label: m['admin.ai.providerOllama']() },
                                    { value: 'openai_compatible', label: m['admin.ai.providerCompatible']() },
                                ]}
                            />
                        </FieldRow>
                    )}

                    <FieldRow
                        label={m['admin.ai.settings.endpoint']()}
                        desc={
                            value.provider === 'openai_compatible'
                                ? m['admin.ai.settings.endpointCompatibleHint']()
                                : value.provider === 'openrouter'
                                  ? m['admin.ai.settings.endpointOpenrouterHint']()
                                  : capabilities.selfHosted
                                    ? m['admin.ai.settings.endpointOllamaHint']()
                                    : m['admin.ai.settings.endpointOpenaiHint']()
                        }
                    >
                        <Input
                            value={value.endpoint}
                            onChange={event => patch({ endpoint: event.target.value })}
                            placeholder={DEFAULT_ENDPOINTS[value.provider] || 'https://…'}
                            readOnly={value.provider === 'openrouter'}
                        />
                    </FieldRow>

                    {!probeOutdated && capabilities.shimmedOllama && (
                        <SettingNotice title={m['admin.ai.settings.shimWarnTitle']()}>
                            {m['admin.ai.settings.shimWarnBody']()}
                        </SettingNotice>
                    )}

                    {capabilities.apiKey ? (
                        <FieldRow
                            label={
                                capabilities.apiKeyOptional
                                    ? m['admin.ai.settings.apiKeyOptional']()
                                    : m['admin.ai.settings.apiKey']()
                            }
                        >
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
                            {value.provider === 'openrouter' && (
                                <a
                                    href="https://openrouter.ai/settings/keys"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline"
                                >
                                    {m['admin.ai.settings.openrouterManageKeys']()}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
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
                        value.provider === 'openrouter'
                            ? m['admin.ai.settings.modelOpenrouterHint']()
                            : !discovered
                            ? capabilities.presets.length > 0
                                ? m['admin.ai.settings.modelPresetHint']()
                                : m['admin.ai.settings.modelExactHint']()
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
                            readOnly={value.provider === 'openrouter'}
                        />
                        {value.provider !== 'openrouter' && <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title={
                                probeOutdated
                                    ? m['admin.ai.settings.saveBeforeProbe']()
                                    : m['admin.ai.settings.refreshModels']()
                            }
                            onClick={() => refreshModels.mutate()}
                            disabled={modelsRefreshing || probeOutdated}
                        >
                            <RefreshCw className={cn('h-4 w-4', modelsRefreshing && 'animate-spin')} />
                        </Button>}
                    </div>
                </FieldRow>

                {value.provider !== 'openrouter' && <div className="flex flex-wrap gap-1.5">
                    {discovered
                        ? models.map(model => {
                            const size = formatSize(model.size);

                            return (
                                <button
                                    key={model.id}
                                    type="button"
                                    onClick={() => patch({ model: model.id })}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors',
                                        value.model === model.id
                                            ? 'border-[var(--brand)]/60 bg-[var(--brand-soft)] text-[var(--brand)]'
                                            : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:border-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
                                    )}
                                >
                                    {/* A disk icon only means something for a model that
                                        occupies disk here; a hosted model has no local
                                        footprint and no size to report. */}
                                    {capabilities.selfHosted && <HardDrive className="h-3 w-3 opacity-60" />}
                                    {model.id}
                                    {size && <span className="opacity-60">{size}</span>}
                                </button>
                            );
                        })
                        : capabilities.presets.map(id => (
                            <span
                                key={id}
                                className="inline-flex items-center rounded-full border border-dashed border-[var(--color-border-strong)] px-2.5 py-1 font-mono text-xs text-[var(--color-ink-faint)]"
                            >
                                {id}
                            </span>
                        ))}
                </div>}

                {value.provider === 'openrouter' && (
                    <SettingNotice title={m['admin.ai.settings.openrouterFreeTitle']()}>
                        {m['admin.ai.settings.openrouterFreeBody']()}
                    </SettingNotice>
                )}

                {value.provider !== 'openrouter' && modelsError && !probeOutdated && (
                    <p className="text-xs text-[var(--color-warning)]">
                        {firstError(modelsFailure) ?? m['admin.ai.settings.modelsUnavailable']()}
                    </p>
                )}

                {value.provider === 'openai_compatible' && (
                    <div
                        className={cn(
                            'flex min-w-0 flex-col gap-2 rounded-md border p-2.5 sm:flex-row sm:items-center sm:justify-between',
                            toolTestStatus === 'supported'
                                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10'
                                : toolTestStatus === 'error'
                                  ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10'
                                  : 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10',
                        )}
                    >
                        <div className="flex min-w-0 gap-2">
                            {toolTestStatus === 'supported' ? (
                                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
                            ) : (
                                <TriangleAlert
                                    className={cn(
                                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                                        toolTestStatus === 'error'
                                            ? 'text-[var(--color-danger)]'
                                            : 'text-[var(--color-warning)]',
                                    )}
                                />
                            )}
                            <p className="min-w-0 break-words text-xs text-[var(--color-ink-muted)]">
                                {probeOutdated
                                    ? m['admin.ai.settings.saveBeforeToolProbe']()
                                    : toolTestStatus === 'supported'
                                      ? m['admin.ai.settings.toolCallingVerified']({ model: toolTestModel })
                                      : toolTestStatus === 'unsupported'
                                        ? m['admin.ai.settings.toolCallingUnsupported']({ model: toolTestModel })
                                        : toolTestStatus === 'error'
                                          ? toolTestResult?.message ?? m['common.states.genericError']()
                                          : m['admin.ai.settings.toolCallingUnverified']()}
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="shrink-0 self-start sm:self-auto"
                            title={probeOutdated ? m['admin.ai.settings.saveBeforeToolProbe']() : undefined}
                            onClick={() => testTools.mutate()}
                            disabled={testTools.isPending || probeOutdated || value.model.trim() === ''}
                        >
                            <Wrench className="h-3.5 w-3.5" />
                            {testTools.isPending
                                ? m['admin.ai.settings.testingToolCalling']()
                                : m['admin.ai.settings.testToolCalling']()}
                        </Button>
                    </div>
                )}

                {/* A failed model-level probe blocks the agent. Native
                    providers report that state without needing live inference. */}
                {value.provider !== 'openai_compatible'
                    && !probeOutdated
                    && inference?.capabilities
                    && (inference.capabilities.supports_tools === false || inference.capabilities.warnings.length > 0) && (
                    <div className="flex min-w-0 gap-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                        <p className="min-w-0 break-words text-xs text-[var(--color-ink-muted)]">
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
