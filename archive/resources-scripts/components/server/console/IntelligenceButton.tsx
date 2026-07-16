import stripAnsi from 'strip-ansi';
import { useEffect, useState, useRef, KeyboardEvent } from 'react';
import { ServerContext } from '@/state/server';
import { Button } from '@/elements/button';
import { SparklesIcon, XIcon } from '@heroicons/react/outline';
import { SocketEvent } from '@server/events';
import Dialog from '@/elements/dialog/Dialog';
import Spinner from '@/elements/Spinner';
import { handleQueryStream } from '@/api/routes/server/ai';
import { useStoreState } from '@/state/hooks';

const MAX_LOG_LINES = 100;
const MAX_LOG_CHARS = 6000;

type Stage = 'input' | 'loading' | 'response';

export default () => {
    const [log, setLog] = useState<string[]>([]);
    const [response, setResponse] = useState<string>('');
    const [stage, setStage] = useState<Stage>('input');
    const [open, setOpen] = useState<boolean>(false);
    const [hasCrash, setHasCrash] = useState<boolean>(false);
    const [toastVisible, setToastVisible] = useState<boolean>(false);
    const [customQuery, setCustomQuery] = useState<string>('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isEnabled = useStoreState(state => state.everest.data!.ai.enabled);
    const assistantEnabled = useStoreState(state => state.everest.data!.ai.feature_server_assistant ?? true);
    const crashEnabled = useStoreState(state => state.everest.data!.ai.feature_crash_analysis ?? true);
    const theme = useStoreState(state => state.theme.data!);
    const status = ServerContext.useStoreState(state => state.status.value);
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { connected, instance } = ServerContext.useStoreState(state => state.socket);

    // Cleanup when dialog closes
    useEffect(() => {
        if (!open && abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setResponse('');
            setStage('input');
        }
    }, [open]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    const showCrashToast = () => {
        setToastVisible(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
            setToastVisible(false);
        }, 10000);
    };

    const dismissToast = () => {
        setToastVisible(false);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };

    const cancelRequest = () => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setStage('input');
    };

    const submitQuery = (query: string, queryType: 'log_analysis' | 'freeform') => {
        setStage('loading');
        setResponse('');

        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        handleQueryStream(
            uuid,
            query,
            queryType,
            chunk => {
                setResponse(prev => prev + chunk);
            },
            () => {
                setStage('response');
                abortControllerRef.current = null;
            },
            error => {
                console.error('AI query error:', error);
                setResponse('Error: Failed to get AI response. Please try again.');
                setStage('response');
                abortControllerRef.current = null;
            },
            abortControllerRef.current.signal,
        );
    };

    const analyzeLogs = () => {
        let data =
            stripAnsi(
                log
                    .slice(-MAX_LOG_LINES)
                    .map(it => it.replace('\r', ''))
                    .join('\n'),
            ) || '';
        // Truncate from the start so we keep the most recent (most relevant) log lines
        if (data.length > MAX_LOG_CHARS) {
            data = data.slice(data.length - MAX_LOG_CHARS);
        }
        submitQuery(data, 'log_analysis');
    };

    const askQuestion = () => {
        const q = customQuery.trim();
        if (!q) return;
        submitQuery(q, 'freeform');
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askQuestion();
        }
    };

    useEffect(() => {
        if (!connected || !instance || status === 'running') return;

        const listener = (line: string) => {
            setLog(prevLog => [...prevLog, line.startsWith('>') ? line.substring(1) : line]);

            if (line.toLowerCase().indexOf('detected server process in a crashed state') >= 0) {
                setHasCrash(true);
                if (crashEnabled) showCrashToast();
            }
        };

        instance.addListener(SocketEvent.CONSOLE_OUTPUT, listener);

        return () => {
            instance.removeListener(SocketEvent.CONSOLE_OUTPUT, listener);
        };
    }, [connected, instance, status]);

    if (!isEnabled) return <></>;
    if (!assistantEnabled && !crashEnabled) return <></>;

    return (
        <>
            {/* Crash toast — only shown when crash_analysis feature is enabled */}
            {crashEnabled && (
                <div
                    className={'fixed bottom-6 right-6 z-50 transition-all duration-500'}
                    style={{
                        transform: toastVisible ? 'translateY(0)' : 'translateY(120%)',
                        opacity: toastVisible ? 1 : 0,
                        pointerEvents: toastVisible ? 'auto' : 'none',
                    }}
                >
                    <div
                        className={'flex items-center gap-3 rounded-xl border border-red-700/60 px-4 py-3 shadow-2xl'}
                        style={{ backgroundColor: theme.colors.secondary }}
                    >
                        <SparklesIcon className={'h-5 w-5 flex-shrink-0 text-red-400'} />
                        <div>
                            <p className={'text-sm font-semibold text-red-300'}>Crash Detected</p>
                            <p className={'text-xs text-neutral-400'}>AI can help diagnose this</p>
                        </div>
                        <button
                            className={
                                'ml-2 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90'
                            }
                            style={{ backgroundColor: theme.colors.primary }}
                            onClick={() => {
                                dismissToast();
                                setOpen(true);
                            }}
                        >
                            Analyze
                        </button>
                        <button onClick={dismissToast} className={'ml-1 text-neutral-500 hover:text-neutral-200'}>
                            <XIcon className={'h-4 w-4'} />
                        </button>
                    </div>
                </div>
            )}

            {/* Ask AI button — only shown when server_assistant feature is enabled */}
            {assistantEnabled && (
                <Button
                    size={'sm'}
                    variant={hasCrash ? 'danger' : 'secondary'}
                    onClick={() => setOpen(true)}
                    className={hasCrash ? 'animate-pulse' : ''}
                >
                    <SparklesIcon className={'mr-1 w-4'} />
                    {hasCrash ? 'Crash Detected' : 'Ask AI'}
                </Button>
            )}

            <Dialog
                open={open}
                onClose={() => {
                    cancelRequest();
                    setOpen(false);
                    setHasCrash(false);
                }}
                title={'Server Assistant'}
            >
                {stage === 'input' && (
                    <div className={'space-y-4'}>
                        {hasCrash && (
                            <div className={'rounded bg-red-900/40 p-3 text-sm text-red-300'}>
                                A crash was detected. Click <strong>Analyze Crash</strong> to diagnose it, or ask a
                                custom question below.
                            </div>
                        )}
                        <div>
                            <textarea
                                className={
                                    'w-full resize-none rounded bg-black/50 p-3 font-mono text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
                                }
                                placeholder={'Ask a question about your server... (Enter to send)'}
                                rows={3}
                                value={customQuery}
                                onChange={e => setCustomQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                            />
                        </div>
                        <div className={'flex justify-end gap-2'}>
                            {hasCrash && crashEnabled && (
                                <Button size={'sm'} onClick={analyzeLogs}>
                                    Analyze Crash
                                </Button>
                            )}
                            <Button size={'sm'} onClick={askQuestion} disabled={customQuery.trim().length < 1}>
                                Ask AI
                            </Button>
                        </div>
                    </div>
                )}

                {(stage === 'loading' || stage === 'response') && (
                    <div className={'space-y-4'}>
                        {stage === 'loading' && (
                            <div className={'flex items-center gap-2'}>
                                <Spinner size={'small'} />
                                <span className={'animate-pulse text-sm text-gray-400'}>Thinking...</span>
                            </div>
                        )}
                        {response && (
                            <div
                                className={
                                    'max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/50 p-3 text-sm'
                                }
                            >
                                {response}
                            </div>
                        )}
                        <div className={'flex justify-end gap-2'}>
                            {stage === 'loading' ? (
                                <Button variant={'secondary'} size={'sm'} onClick={cancelRequest}>
                                    Cancel
                                </Button>
                            ) : (
                                <Button
                                    variant={'secondary'}
                                    size={'sm'}
                                    onClick={() => {
                                        setStage('input');
                                        setResponse('');
                                        setCustomQuery('');
                                    }}
                                >
                                    Ask Another
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </Dialog>
        </>
    );
};
