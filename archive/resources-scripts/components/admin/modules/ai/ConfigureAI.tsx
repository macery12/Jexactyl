import { updateSettings } from '@/api/routes/admin/ai/settings';
import Input from '@/elements/Input';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import Tooltip from '@/elements/tooltip/Tooltip';
import { useFlashKey } from '@/plugins/useFlash';
import { Dialog } from '@/elements/dialog';
import { faCheckCircle, faExclamationTriangle, faExternalLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Form, Formik, FormikHelpers } from 'formik';
import { useState } from 'react';
import { object, string } from 'yup';
import { useStoreState } from '@/state/hooks';

interface ConfigureAIProps {
    onDismiss?: () => void;
}

interface Values {
    mode: string;
    endpoint: string;
    key?: string;
    model: string;
}

export default ({ onDismiss }: ConfigureAIProps) => {
    const [loading, setLoading] = useState<boolean>(false);
    const { primary } = useStoreState(state => state.theme.data!.colors);

    const { addFlash, clearAndAddHttpError } = useFlashKey('admin:settings:ai');

    const validation = object({
        // Yup's built-in .url() rejects http://localhost:* (no TLD), so use a custom test
        // that accepts any valid http/https URL including local Ollama endpoints.
        endpoint: string()
            .required()
            .test('is-url', 'Must be a valid URL (e.g. http://localhost:11434/v1)', value => {
                if (!value) return false;
                try {
                    const parsed = new URL(value);
                    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
                } catch {
                    return false;
                }
            }),
        model: string().required(),
        key: string().optional(),
    });

    const submit = (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        setLoading(true);

        updateSettings({
            mode: values.mode,
            endpoint: values.endpoint,
            key: values.mode === 'ollama' ? undefined : values.key,
            model: values.model,
        })
            .then(() => {
                addFlash({
                    type: 'success',
                    title: 'Success',
                    message: 'AI settings have been updated.',
                });
                onDismiss?.();
            })
            .catch(error => {
                setSubmitting(false);
                setLoading(false);
                clearAndAddHttpError(error);
            });
    };

    const ollamaSmallModelSuggestions = [
        'phi3:mini',
        'phi3:small',
        'gemma2:2b',
        'qwen2.5:1.5b',
        'qwen2.5:3b',
        'deepseek-coder:1.3b',
        'starcoder2:3b',
    ];

    return (
        <Dialog open onClose={() => onDismiss?.()} title={'Configure M12Labs-AI'}>
            <SpinnerOverlay visible={loading} />
            <div className={'mt-2 text-sm text-gray-400'}>
                <p>
                    In order to use <span style={{ color: primary }}>M12Labs-AI</span>, you must configure an
                    OpenAI-compatible API endpoint.
                </p>
                <p className={'my-2 text-gray-400'}>
                    You can use{' '}
                    <a
                        href={'https://github.com/ollama/ollama'}
                        target={'_blank'}
                        rel={'noreferrer'}
                        className={'text-blue-400 hover:text-blue-300'}
                    >
                        Ollama
                        <FontAwesomeIcon icon={faExternalLink} className={'ml-1'} />
                    </a>{' '}
                    for local AI or an OpenAI-compatible API provider.
                </p>
                <div className={'mt-3 rounded bg-neutral-900/60 p-3'}>
                    <div className={'flex items-start gap-2'}>
                        <FontAwesomeIcon icon={faExclamationTriangle} className={'mt-0.5 text-yellow-400'} />
                        <div>
                            <p className={'text-gray-300'}>
                                Make sure your endpoint supports the OpenAI Chat Completions API format.
                            </p>
                            <p className={'text-xs text-gray-500 mt-1'}>
                                If you use Ollama, enable the OpenAI-compatible endpoint and use the <code>/v1</code>{' '}
                                base URL.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <Formik
                initialValues={
                    {
                        mode: 'openai',
                        endpoint: 'https://api.openai.com/v1',
                        key: '',
                        model: 'gpt-3.5-turbo',
                    } as Values
                }
                validationSchema={validation}
                onSubmit={submit}
            >
                {({ isSubmitting, values, setFieldValue }) => (
                    <Form className={'mt-6'}>
                        <div className={'mb-4'}>
                            <label className={'block text-sm text-gray-400 mb-1'}>Mode</label>
                            <div className={'flex items-center gap-3'}>
                                <button
                                    type={'button'}
                                    className={`px-3 py-2 rounded text-sm border ${
                                        values.mode === 'openai'
                                            ? 'border-green-500 text-green-300'
                                            : 'border-gray-700 text-gray-400'
                                    }`}
                                    onClick={() => {
                                        setFieldValue('mode', 'openai');
                                        setFieldValue('endpoint', 'https://api.openai.com/v1');
                                        setFieldValue('model', 'gpt-3.5-turbo');
                                    }}
                                >
                                    Standard
                                </button>
                                <button
                                    type={'button'}
                                    className={`px-3 py-2 rounded text-sm border ${
                                        values.mode === 'ollama'
                                            ? 'border-green-500 text-green-300'
                                            : 'border-gray-700 text-gray-400'
                                    }`}
                                    onClick={() => {
                                        setFieldValue('mode', 'ollama');
                                        setFieldValue('endpoint', 'http://localhost:11434/v1');
                                        setFieldValue('model', 'phi3:mini');
                                        setFieldValue('key', '');
                                    }}
                                >
                                    Ollama
                                </button>
                                <Tooltip
                                    content={
                                        values.mode === 'ollama'
                                            ? 'Ollama mode uses a local/remote model and no API key'
                                            : 'Standard mode requires HTTPS and an API key'
                                    }
                                >
                                    <FontAwesomeIcon icon={faCheckCircle} className={'text-gray-600'} />
                                </Tooltip>
                            </div>
                        </div>

                        <div className={'mb-4'}>
                            <label className={'block text-sm text-gray-400 mb-1'}>API Endpoint URL</label>
                            <Input
                                placeholder={
                                    values.mode === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'
                                }
                                value={values.endpoint}
                                onChange={e => setFieldValue('endpoint', e.currentTarget.value)}
                            />
                            <p className={'mt-1 text-xs text-gray-500'}>
                                {values.mode === 'ollama'
                                    ? 'Default Ollama endpoint. Can be HTTP for local or HTTPS for remote.'
                                    : 'The base URL for the OpenAI-compatible API endpoint. Must use HTTPS. Example: https://api.openai.com/v1'}
                            </p>
                        </div>

                        <div className={'mb-4'}>
                            <label className={'block text-sm text-gray-400 mb-1'}>Model Name</label>
                            <Input
                                placeholder={values.mode === 'ollama' ? 'phi3:mini' : 'gpt-3.5-turbo'}
                                value={values.model}
                                onChange={e => setFieldValue('model', e.currentTarget.value)}
                            />
                            <p className={'mt-1 text-xs text-gray-500'}>
                                {values.mode === 'ollama'
                                    ? `Ollama model name (smaller models recommended for Minecraft log reading / debugging). Examples: ${ollamaSmallModelSuggestions.join(
                                          ', ',
                                      )}`
                                    : 'OpenAI model name (e.g., gpt-3.5-turbo, gpt-4)'}
                            </p>
                        </div>

                        {values.mode === 'openai' && (
                            <div className={'relative mb-6'}>
                                <label className={'block text-sm text-gray-400 mb-1'}>API Key</label>
                                <Input
                                    type={'password'}
                                    value={values.key || ''}
                                    onChange={e => setFieldValue('key', e.currentTarget.value)}
                                    placeholder={'sk-...'}
                                />
                                <p className={'mt-1 text-xs text-gray-500'}>
                                    Your API key is stored securely and used to authenticate requests.
                                </p>

                                {!(values.mode === 'ollama' || (values.key || '').length >= 20) && (
                                    <div className={'mt-2 text-xs text-red-400'}>
                                        API key looks too short. Make sure you pasted the full key.
                                    </div>
                                )}
                            </div>
                        )}

                        <div className={'flex items-center justify-end gap-3'}>
                            <button
                                type={'button'}
                                className={'px-4 py-2 rounded bg-gray-700 text-gray-200 hover:bg-gray-600'}
                                onClick={() => onDismiss?.()}
                                disabled={isSubmitting || loading}
                            >
                                Cancel
                            </button>
                            <button
                                type={'submit'}
                                className={
                                    'px-4 py-2 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50'
                                }
                                disabled={
                                    isSubmitting ||
                                    loading ||
                                    !(values.mode === 'ollama' || (values.key || '').length >= 20)
                                }
                            >
                                Save
                            </button>
                        </div>
                    </Form>
                )}
            </Formik>
        </Dialog>
    );
};
