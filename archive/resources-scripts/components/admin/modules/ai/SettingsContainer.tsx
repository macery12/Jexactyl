import Field, { TextareaField } from '@/elements/Field';
import { Field as FormikField, Form, Formik, useFormikContext } from 'formik';
import AdminBox from '@/elements/AdminBox';
import { useStoreState } from '@/state/hooks';
import {
    faKey,
    faTrash,
    faWifi,
    faMicrochip,
    faShieldAlt,
    faSliders,
    faRobot,
} from '@fortawesome/free-solid-svg-icons';
import {
    AIAdminSettings,
    AISettings,
    fetchSettings,
    updateSettings,
    testConnection,
    type ConnectionTestResult,
} from '@/api/routes/admin/ai/settings';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Spinner from '@/elements/Spinner';

const OPENAI_PRESETS = [
    { label: 'GPT-4.1 mini', value: 'gpt-4.1-mini', note: 'Fast & cheap, great for most tasks (recommended)' },
    { label: 'GPT-4.1', value: 'gpt-4.1', note: 'Most capable GPT-4.1 model' },
    { label: 'GPT-4o', value: 'gpt-4o', note: 'Flagship multimodal model' },
    { label: 'GPT-4o mini', value: 'gpt-4o-mini', note: 'Fast and affordable GPT-4o' },
    { label: 'o4-mini', value: 'o4-mini', note: 'Fast reasoning model' },
    { label: 'o3', value: 'o3', note: 'Most powerful reasoning model' },
];

const OLLAMA_PRESETS = [
    { label: 'qwen2.5:7b', value: 'qwen2.5:7b', note: '~4.7GB, best instruction following — recommended' },
    { label: 'qwen2.5:3b', value: 'qwen2.5:3b', note: '~2GB, strong reasoning, lower VRAM' },
    { label: 'phi3:mini', value: 'phi3:mini', note: '~2GB, fast, great for log reading' },
    { label: 'llama3.2:3b', value: 'llama3.2:3b', note: '~2GB, Meta latest small model' },
    { label: 'mistral:7b', value: 'mistral:7b', note: '~4GB, strong general purpose' },
    { label: 'deepseek-coder:1.3b', value: 'deepseek-coder:1.3b', note: '~1GB, code & config focused' },
];

const TEMP_LABELS: [number, string, string][] = [
    [0.0, 'Deterministic', 'Exact, repeatable answers. Best for log analysis.'],
    [0.3, 'Focused', 'Mostly factual with slight variation. Recommended.'],
    [0.7, 'Balanced', 'More varied responses, still coherent.'],
    [1.0, 'Creative', 'Highly varied. Good for brainstorming, not debugging.'],
];

function tempLabel(val: number): { label: string; hint: string } {
    const closest = TEMP_LABELS.reduce((a, b) => (Math.abs(b[0] - val) < Math.abs(a[0] - val) ? b : a));
    return { label: closest[1], hint: closest[2] };
}

function SettingsForm({
    ai,
    deletingKey,
    testing,
    testResult,
    onDeleteKey,
    onTestConnection,
}: {
    ai: AIAdminSettings;
    deletingKey: boolean;
    testing: boolean;
    testResult: ConnectionTestResult | null;
    onDeleteKey: () => void;
    onTestConnection: () => void;
}) {
    const { values, setFieldValue } = useFormikContext<AISettings>();
    const theme = useStoreState(s => s.theme.data!);
    const accent = theme.colors.primary;
    const bgColor = theme.colors.background;
    const presets = values.mode === 'ollama' ? OLLAMA_PRESETS : OPENAI_PRESETS;
    const tempInfo = tempLabel(Number(values.temperature ?? 0.3));
    const systemPromptLen = String(values.system_prompt ?? '').length;
    const MAX_PROMPT = 1000;

    return (
        <Form>
            <AdminBox title={'Provider'} icon={faMicrochip} className={'mb-4'}>
                <div className={'grid gap-4 md:grid-cols-3'}>
                    <div>
                        <label className={'mb-1.5 block text-xs font-medium text-neutral-300'}>Provider Mode</label>
                        <FormikField
                            as="select"
                            id={'mode'}
                            name={'mode'}
                            className={
                                'w-full rounded border border-neutral-600 px-3 py-2 text-sm text-neutral-100 focus:outline-none'
                            }
                            style={{ backgroundColor: bgColor, borderColor: 'transparent' }}
                            onFocus={(e: React.FocusEvent<HTMLSelectElement>) =>
                                (e.currentTarget.style.borderColor = accent)
                            }
                            onBlur={(e: React.FocusEvent<HTMLSelectElement>) =>
                                (e.currentTarget.style.borderColor = 'transparent')
                            }
                        >
                            <option value="openai">OpenAI / Standard (HTTPS)</option>
                            <option value="ollama">Ollama (Local / HTTPS)</option>
                        </FormikField>
                        <p className={'mt-1 text-xs text-neutral-500'}>
                            {values.mode === 'ollama'
                                ? 'HTTP allowed for local Ollama. No API key required.'
                                : 'Requires HTTPS endpoint and an API key.'}
                        </p>
                    </div>

                    <div>
                        <label className={'mb-1.5 block text-xs font-medium text-neutral-300'}>API Endpoint</label>
                        <Field
                            id={'endpoint'}
                            name={'endpoint'}
                            type={'input'}
                            placeholder={
                                values.mode === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'
                            }
                        />
                        <p className={'mt-1 text-xs text-neutral-500'}>
                            {values.mode === 'ollama' ? 'Default: http://localhost:11434/v1' : 'Must end in /v1'}
                        </p>
                    </div>

                    {values.mode === 'openai' ? (
                        <div>
                            <label className={'mb-1.5 block text-xs font-medium text-neutral-300'}>
                                <FontAwesomeIcon icon={faKey} className={'mr-1.5 opacity-60'} />
                                API Key
                            </label>
                            <Field
                                id={'key'}
                                name={'key'}
                                type={'input'}
                                placeholder={ai.key ? '•••••••• (leave blank to keep current)' : 'sk-...'}
                            />
                            {ai.key && (
                                <button
                                    type="button"
                                    onClick={onDeleteKey}
                                    disabled={deletingKey}
                                    className={
                                        'mt-1.5 inline-flex items-center gap-1.5 rounded bg-red-600/80 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50'
                                    }
                                >
                                    <FontAwesomeIcon icon={faTrash} className={'h-3 w-3'} />
                                    {deletingKey ? 'Deleting...' : 'Remove saved key'}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div
                            className={'flex items-start rounded border border-neutral-700/50 px-3 py-2.5'}
                            style={{ backgroundColor: bgColor }}
                        >
                            <p className={'text-xs text-neutral-500'}>
                                Ollama does not require an API key. Leave the key field blank.
                            </p>
                        </div>
                    )}
                </div>
            </AdminBox>

            <AdminBox title={'Model & Performance'} icon={faSliders} className={'mb-4'}>
                <div className={'grid gap-6 md:grid-cols-2'}>
                    <div>
                        <label className={'mb-1.5 block text-xs font-medium text-neutral-300'}>Model Name</label>
                        <Field id={'model'} name={'model'} type={'input'} />
                        <div className={'mt-2 flex flex-wrap gap-1.5'}>
                            {presets.map(p => (
                                <button
                                    key={p.value}
                                    type="button"
                                    onClick={() => setFieldValue('model', p.value)}
                                    title={p.note}
                                    className={
                                        'rounded-full border px-2.5 py-0.5 text-xs transition-colors ' +
                                        (values.model === p.value
                                            ? 'border-neutral-600'
                                            : 'border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-200')
                                    }
                                    style={
                                        values.model === p.value
                                            ? { borderColor: accent, backgroundColor: accent + '33', color: accent }
                                            : { backgroundColor: bgColor }
                                    }
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <p className={'mt-2 text-xs text-neutral-500'}>
                            Click a preset or type a custom model name. Hover presets for details.
                        </p>
                        {values.mode === 'ollama' && (
                            <p className={'mt-1.5 text-xs text-neutral-600'}>
                                💡 Ollama keeps the model loaded for{' '}
                                <span className={'text-neutral-400'}>10 minutes</span> after each request. The{' '}
                                <span className={'text-neutral-400'}>first request</span> after a cold start may take
                                20–60 seconds while the model loads into memory.
                            </p>
                        )}
                    </div>

                    <div className={'space-y-4'}>
                        <div>
                            <div className={'mb-1.5 flex items-center justify-between'}>
                                <label className={'text-xs font-medium text-neutral-300'}>Max Response Tokens</label>
                                <span className={'font-mono text-xs'} style={{ color: accent }}>
                                    {values.max_tokens ?? 500}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={50}
                                max={4000}
                                step={50}
                                value={values.max_tokens ?? 500}
                                onChange={e => setFieldValue('max_tokens', Number(e.target.value))}
                                className={'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-700'}
                                style={{ accentColor: accent } as React.CSSProperties}
                            />
                            <div className={'mt-1 flex justify-between text-xs text-neutral-600'}>
                                <span>50 - brief</span>
                                <span>4000 - detailed</span>
                            </div>
                        </div>

                        <div>
                            <div className={'mb-1.5 flex items-center justify-between'}>
                                <label className={'text-xs font-medium text-neutral-300'}>Temperature</label>
                                <span className={'font-mono text-xs'} style={{ color: accent }}>
                                    {Number(values.temperature ?? 0.3).toFixed(1)}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={values.temperature ?? 0.3}
                                onChange={e => setFieldValue('temperature', parseFloat(e.target.value))}
                                className={'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-700'}
                                style={{ accentColor: accent } as React.CSSProperties}
                            />
                            <div className={'mt-1.5 flex items-center gap-2'}>
                                <span
                                    className={'rounded px-2 py-0.5 text-xs font-medium'}
                                    style={{ backgroundColor: accent + '33', color: accent }}
                                >
                                    {tempInfo.label}
                                </span>
                                <span className={'text-xs text-neutral-500'}>{tempInfo.hint}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </AdminBox>

            <AdminBox title={'Access & Behavior'} icon={faShieldAlt} className={'mb-4'}>
                <label className={'mb-1.5 block text-xs font-medium text-neutral-300'}>Feature Toggles</label>
                <div className={'space-y-2'}>
                    <label
                        className={
                            'flex cursor-pointer items-center gap-3 rounded border border-neutral-700 px-3 py-2.5 transition-opacity hover:opacity-80'
                        }
                        style={{ backgroundColor: bgColor }}
                    >
                        <FormikField
                            type="checkbox"
                            name="feature_server_assistant"
                            className={'h-4 w-4 cursor-pointer rounded'}
                            style={{ accentColor: accent } as React.CSSProperties}
                        />
                        <div>
                            <p className={'text-sm font-medium text-neutral-200'}>Server AI Assistant</p>
                            <p className={'text-xs text-neutral-500'}>
                                AI chat tab and "Ask AI" button on server pages.
                            </p>
                        </div>
                    </label>
                    <label
                        className={
                            'flex cursor-pointer items-center gap-3 rounded border border-neutral-700 px-3 py-2.5 transition-opacity hover:opacity-80'
                        }
                        style={{ backgroundColor: bgColor }}
                    >
                        <FormikField
                            type="checkbox"
                            name="feature_crash_analysis"
                            className={'h-4 w-4 cursor-pointer rounded'}
                            style={{ accentColor: accent } as React.CSSProperties}
                        />
                        <div>
                            <p className={'text-sm font-medium text-neutral-200'}>Crash Analysis</p>
                            <p className={'text-xs text-neutral-500'}>
                                Auto-detect crashes and offer AI diagnosis via a toast.
                            </p>
                        </div>
                    </label>
                </div>
            </AdminBox>

            <AdminBox title={'System Prompt'} icon={faRobot} className={'mb-4'}>
                <div className={'flex items-start justify-between gap-2 mb-2'}>
                    <p className={'text-xs text-neutral-500'}>
                        Sent with every request to define the AI's role and tone. Keep it concise — it counts toward
                        your token budget.
                    </p>
                    <span
                        className={`flex-shrink-0 text-xs tabular-nums ${systemPromptLen > MAX_PROMPT ? 'text-red-400' : 'text-neutral-500'}`}
                    >
                        {systemPromptLen} / {MAX_PROMPT}
                    </span>
                </div>
                <TextareaField
                    id={'system_prompt'}
                    name={'system_prompt'}
                    rows={5}
                    placeholder="You are an expert game server technician specializing in crash analysis and debugging..."
                />
            </AdminBox>

            <div className={'flex items-center justify-between'}>
                <p className={'text-xs text-neutral-600'}>Changes take effect on the next request after saving.</p>
                <div className={'flex items-center gap-3'}>
                    {testResult && (
                        <span
                            className={`text-xs font-medium ${testResult.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}
                        >
                            {testResult.status === 'ok'
                                ? `✓ Connected (${testResult.latency_ms}ms)`
                                : `✗ ${testResult.message}`}
                        </span>
                    )}
                    <Button type={'button'} variant={'secondary'} onClick={onTestConnection} disabled={testing}>
                        <FontAwesomeIcon icon={faWifi} className={'mr-1.5 h-3 w-3'} />
                        {testing ? 'Testing...' : 'Test Connection'}
                    </Button>
                    <Button type={'submit'}>Save Changes</Button>
                </div>
            </div>
        </Form>
    );
}

export default () => {
    const { clearFlashes, clearAndAddHttpError, addFlash } = useFlash();
    const [settings, setSettings] = useState<AIAdminSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [deletingKey, setDeletingKey] = useState(false);
    const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        fetchSettings()
            .then(setSettings)
            .catch(error => clearAndAddHttpError({ key: 'admin:ai:settings', error }))
            .finally(() => setLoading(false));
    }, []);

    const handleTestConnection = () => {
        setTesting(true);
        setTestResult(null);
        testConnection()
            .then(setTestResult)
            .catch(() => setTestResult({ status: 'error', message: 'Request failed. Check endpoint and try again.' }))
            .finally(() => setTesting(false));
    };

    const handleDeleteKey = () => {
        if (!confirm('Remove the saved API key? AI will stop working until you add a new one.')) return;

        setDeletingKey(true);
        clearFlashes();
        updateSettings({ key: '' })
            .then(() => {
                addFlash({
                    type: 'success',
                    key: 'admin:ai:settings',
                    message: 'API key has been deleted successfully.',
                });
                setTimeout(() => window.location.reload(), 500);
            })
            .catch(error => {
                setDeletingKey(false);
                clearAndAddHttpError({ key: 'admin:ai:settings', error });
            });
    };

    const submit = (values: AISettings) => {
        clearFlashes();
        const payload: AISettings = { ...values };
        if (!payload.key?.trim()) {
            delete payload.key;
        }

        updateSettings(payload)
            .then(() => {
                addFlash({
                    type: 'success',
                    key: 'admin:ai:settings',
                    message: 'Settings have been updated successfully.',
                });
                setTimeout(() => window.location.reload(), 500);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:ai:settings', error });
            });
    };

    if (loading) {
        return <Spinner size={'large'} centered />;
    }

    if (!settings) {
        return null;
    }

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                key: '',
                enabled: settings.enabled,
                endpoint:
                    settings.endpoint ||
                    (settings.mode === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'),
                model: settings.model || (settings.mode === 'ollama' ? 'qwen2.5:7b' : 'gpt-4.1-mini'),
                mode: settings.mode || 'openai',
                max_tokens: settings.max_tokens ?? 500,
                temperature: settings.temperature ?? 0.3,
                system_prompt:
                    settings.system_prompt ||
                    'You are a game server support assistant. Help with anything related to game servers: setup, configuration, plugins, mods, gameplay mechanics, commands, world management, and troubleshooting. When given logs: quote the exact failing line, identify if it is a crash/config issue/first-run requirement (e.g. EULA), give numbered fix steps. Be concise and specific — never give generic advice. Only decline if the question is completely unrelated to gaming or servers (e.g. cooking, finance).',
                feature_server_assistant: settings.feature_server_assistant ?? true,
                feature_crash_analysis: settings.feature_crash_analysis ?? true,
            }}
        >
            <SettingsForm
                ai={settings}
                deletingKey={deletingKey}
                testing={testing}
                testResult={testResult}
                onDeleteKey={handleDeleteKey}
                onTestConnection={handleTestConnection}
            />
        </Formik>
    );
};
