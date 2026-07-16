import AdminBox from '@/elements/AdminBox';
import ToggleFeatureButton from '@admin/modules/ai/ToggleFeatureButton';
import { SparklesIcon, RefreshIcon, CheckCircleIcon, XCircleIcon, SearchIcon, XIcon } from '@heroicons/react/outline';
import { useStoreState } from '@/state/hooks';
import { KeyboardEvent as ReactKeyboardEvent, useState, useRef, useEffect, useCallback } from 'react';
import { handleQueryStream } from '@/api/routes/admin/ai/handleQuery';
import {
    fetchSettings,
    getStats,
    getRecentLogs,
    getLogs,
    testConnection,
    type AIAdminSettings,
    type AIStats,
    type AILogEntry,
    type GetLogsParams,
} from '@/api/routes/admin/ai/settings';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import MessageBubble, { type Message } from '@/components/ai/MessageBubble';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    const theme = useStoreState(s => s.theme.data!);
    return (
        <div
            className={'flex flex-col gap-1 rounded-xl border border-neutral-700/60 px-4 py-3'}
            style={{ backgroundColor: theme.colors.secondary }}
        >
            <span className={'text-xs text-neutral-500'}>{label}</span>
            <span className={'text-xl font-semibold text-neutral-100'}>{value}</span>
            {sub && <span className={'text-xs text-neutral-500'}>{sub}</span>}
        </div>
    );
}

function Sparkline({ series }: { series: { date: string; requests: number }[] }) {
    const theme = useStoreState(s => s.theme.data!);
    const max = Math.max(...series.map(s => s.requests), 1);
    const H = 32;
    const W = 120;
    const step = W / Math.max(series.length - 1, 1);
    const points = series.map((s, i) => `${i * step},${H - (s.requests / max) * H}`).join(' ');
    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={'overflow-visible'}>
            <polyline
                fill={'none'}
                stroke={theme.colors.primary}
                strokeWidth={1.5}
                strokeLinecap={'round'}
                strokeLinejoin={'round'}
                points={points}
            />
        </svg>
    );
}

type ConnStatus = { state: 'idle' | 'testing' | 'ok' | 'error'; latency?: number; message?: string };

function ConnectionCard({ settings }: { settings: AIAdminSettings | null }) {
    const theme = useStoreState(s => s.theme.data!);
    const [conn, setConn] = useState<ConnStatus>({ state: 'idle' });

    const runTest = useCallback(() => {
        setConn({ state: 'testing' });
        testConnection()
            .then(r =>
                setConn(
                    r.status === 'ok' ? { state: 'ok', latency: r.latency_ms } : { state: 'error', message: r.message },
                ),
            )
            .catch(() => setConn({ state: 'error', message: 'Request failed' }));
    }, []);

    useEffect(() => {
        runTest();
    }, [runTest]);

    const icon =
        conn.state === 'ok' ? (
            <CheckCircleIcon className={'h-5 w-5 text-green-400'} />
        ) : conn.state === 'error' ? (
            <XCircleIcon className={'h-5 w-5 text-red-400'} />
        ) : (
            <span className={'flex h-5 w-5 items-center justify-center'}>
                <Spinner size={'small'} />
            </span>
        );

    const label =
        conn.state === 'ok' ? (
            <span className={'text-green-400'}>
                Connected{conn.latency !== undefined ? ` · ${conn.latency}ms` : ''}
            </span>
        ) : conn.state === 'error' ? (
            <span className={'text-red-400'}>Error — {conn.message}</span>
        ) : (
            <span className={'text-neutral-500'}>{conn.state === 'testing' ? 'Testing…' : 'Idle'}</span>
        );

    return (
        <div
            className={'flex h-full items-center justify-between rounded-xl border border-neutral-700/60 px-4 py-3'}
            style={{ backgroundColor: theme.colors.secondary }}
        >
            <div className={'flex items-center gap-3'}>
                {icon}
                <div>
                    <p className={'text-xs font-medium text-neutral-200'}>
                        {settings?.mode === 'ollama' ? 'Ollama' : 'OpenAI'} ·{' '}
                        <span className={'font-mono'}>{settings?.model || 'no model'}</span>
                    </p>
                    <p className={'truncate text-xs text-neutral-500'} style={{ maxWidth: '200px' }}>
                        {settings?.endpoint || 'Not configured'}
                    </p>
                    <p className={'mt-0.5 text-xs'}>{label}</p>
                </div>
            </div>
            <button
                onClick={runTest}
                disabled={conn.state === 'testing'}
                className={
                    'ml-4 flex-shrink-0 rounded-lg border border-neutral-700 p-1.5 text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-40'
                }
                title={'Re-test connection'}
            >
                <RefreshIcon className={'h-4 w-4' + (conn.state === 'testing' ? ' animate-spin' : '')} />
            </button>
        </div>
    );
}

function LogRow({ log }: { log: AILogEntry }) {
    return (
        <tr className={'border-b border-neutral-700/20 hover:bg-neutral-800/30'}>
            <td className={'whitespace-nowrap px-3 py-1.5 font-mono text-neutral-500'}>
                {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                <span className={'ml-1 text-neutral-700'}>
                    {new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
            </td>
            <td className={'px-3 py-1.5 text-neutral-300'}>{log.username}</td>
            <td className={'px-3 py-1.5 text-neutral-500'}>
                {log.server_name ?? <span className={'italic text-neutral-700'}>—</span>}
            </td>
            <td className={'px-3 py-1.5 font-mono text-neutral-400'}>{log.model}</td>
            <td className={'px-3 py-1.5'}>
                <span
                    className={
                        'rounded px-1.5 py-0.5 ' +
                        (log.source === 'admin' ? 'bg-purple-900/40 text-purple-300' : 'bg-blue-900/40 text-blue-300')
                    }
                >
                    {log.source}
                </span>
            </td>
            <td className={'px-3 py-1.5 font-mono text-neutral-400'}>{log.total_tokens ?? '—'}</td>
            <td className={'px-3 py-1.5 font-mono text-neutral-400'}>
                {log.latency_ms != null ? `${log.latency_ms}ms` : '—'}
            </td>
            <td className={'px-3 py-1.5'}>
                {log.status === 'success' ? (
                    <span className={'text-green-400'}>✓</span>
                ) : (
                    <span className={'text-red-400'} title={log.error_message ?? undefined}>
                        ✗
                    </span>
                )}
            </td>
        </tr>
    );
}

const LOG_TABLE_HEADERS = ['Time', 'User', 'Server', 'Model', 'Src', 'Tokens', 'Latency', 'Status'];

function LogTableHead() {
    return (
        <thead>
            <tr className={'border-b border-neutral-700/40 text-left text-neutral-500'}>
                {LOG_TABLE_HEADERS.map(h => (
                    <th key={h} className={'px-3 py-2 font-normal'}>
                        {h}
                    </th>
                ))}
            </tr>
        </thead>
    );
}

function LogsModal({ onClose }: { onClose: () => void }) {
    const theme = useStoreState(s => s.theme.data!);
    const [logs, setLogs] = useState<AILogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [source, setSource] = useState<GetLogsParams['source']>('');
    const [status, setStatus] = useState<GetLogsParams['status']>('');

    useEffect(() => {
        setLoading(true);
        getLogs({ source, status, search: search || undefined })
            .then(setLogs)
            .catch(() => setLogs([]))
            .finally(() => setLoading(false));
    }, [source, status, search]);

    // debounce search input
    const [searchInput, setSearchInput] = useState('');
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = (v: string) => {
        setSearchInput(v);
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => setSearch(v), 400);
    };

    // close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const selectClass =
        'rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-neutral-500';

    return (
        <div
            className={'fixed inset-0 z-50 flex items-center justify-center'}
            style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
        >
            <div
                className={
                    'relative mx-4 flex w-full max-w-5xl flex-col rounded-xl border border-neutral-700 shadow-2xl'
                }
                style={{ backgroundColor: theme.colors.secondary, maxHeight: '85vh' }}
            >
                {/* Header */}
                <div
                    className={
                        'flex flex-shrink-0 items-center justify-between border-b border-neutral-700/60 px-5 py-4'
                    }
                >
                    <div>
                        <p className={'text-sm font-semibold text-neutral-200'}>AI Request Logs</p>
                        <p className={'text-xs text-neutral-500'}>Up to 500 most recent records</p>
                    </div>
                    <button
                        onClick={onClose}
                        className={'rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}
                    >
                        <XIcon className={'h-5 w-5'} />
                    </button>
                </div>

                {/* Filter bar */}
                <div
                    className={
                        'flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-neutral-700/40 px-5 py-3'
                    }
                >
                    <div
                        className={'flex items-center gap-1.5 rounded border border-neutral-700 px-2 py-1.5'}
                        style={{ backgroundColor: theme.colors.background }}
                    >
                        <SearchIcon className={'h-3.5 w-3.5 text-neutral-500'} />
                        <input
                            type={'text'}
                            placeholder={'Search by username…'}
                            value={searchInput}
                            onChange={e => handleSearchChange(e.target.value)}
                            className={
                                'w-44 bg-transparent text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none'
                            }
                        />
                        {searchInput && (
                            <button
                                onClick={() => {
                                    setSearchInput('');
                                    setSearch('');
                                }}
                                className={'text-neutral-600 hover:text-neutral-400'}
                            >
                                <XIcon className={'h-3 w-3'} />
                            </button>
                        )}
                    </div>
                    <select
                        value={source}
                        onChange={e => setSource(e.target.value as GetLogsParams['source'])}
                        className={selectClass}
                        style={{ backgroundColor: theme.colors.background }}
                    >
                        <option value={''}>All sources</option>
                        <option value={'client'}>Client</option>
                        <option value={'admin'}>Admin</option>
                    </select>
                    <select
                        value={status}
                        onChange={e => setStatus(e.target.value as GetLogsParams['status'])}
                        className={selectClass}
                        style={{ backgroundColor: theme.colors.background }}
                    >
                        <option value={''}>All statuses</option>
                        <option value={'success'}>Success</option>
                        <option value={'error'}>Error</option>
                    </select>
                    <span className={'ml-auto text-xs text-neutral-600'}>
                        {loading ? 'Loading…' : `${logs.length} record${logs.length !== 1 ? 's' : ''}`}
                    </span>
                </div>

                {/* Table */}
                <div className={'min-h-0 flex-1 overflow-y-auto'}>
                    {loading ? (
                        <div className={'flex justify-center py-10'}>
                            <Spinner size={'small'} />
                        </div>
                    ) : logs.length === 0 ? (
                        <p className={'px-5 py-10 text-center text-xs text-neutral-600'}>
                            No records match your filters
                        </p>
                    ) : (
                        <div className={'overflow-x-auto'}>
                            <table className={'w-full text-xs'}>
                                <LogTableHead />
                                <tbody>
                                    {logs.map(log => (
                                        <LogRow key={log.id} log={log} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function RecentLogsTable({
    logs,
    loading,
    onViewAll,
}: {
    logs: AILogEntry[];
    loading: boolean;
    onViewAll: () => void;
}) {
    const theme = useStoreState(s => s.theme.data!);
    return (
        <div
            className={'rounded-xl border border-neutral-700/60 overflow-hidden'}
            style={{ backgroundColor: theme.colors.secondary }}
        >
            <div className={'flex items-center justify-between border-b border-neutral-700/60 px-4 py-2.5'}>
                <p className={'text-xs font-medium text-neutral-300'}>Recent Requests</p>
                <button
                    onClick={onViewAll}
                    className={'text-xs text-neutral-500 transition-colors hover:text-neutral-300'}
                >
                    View all →
                </button>
            </div>
            {loading ? (
                <div className={'flex justify-center py-6'}>
                    <Spinner size={'small'} />
                </div>
            ) : logs.length === 0 ? (
                <p className={'px-4 py-6 text-center text-xs text-neutral-600'}>No requests logged yet</p>
            ) : (
                <div className={'overflow-x-auto'}>
                    <table className={'w-full text-xs'}>
                        <LogTableHead />
                        <tbody>
                            {logs.map(log => (
                                <LogRow key={log.id} log={log} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default () => {
    const theme = useStoreState(s => s.theme.data!);
    const [settings, setSettings] = useState<AIAdminSettings | null>(null);

    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: `**M12Labs-AI Admin Console**\n\nTest your AI configuration or ask questions about server management.\n\n_Provider and model are loaded from the admin settings panel._`,
        },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const [stats, setStats] = useState<AIStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [logs, setLogs] = useState<AILogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(true);
    const [showLogsModal, setShowLogsModal] = useState(false);
    const [slowHint, setSlowHint] = useState(false);
    const slowHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasFirstToken = useRef(false);

    useEffect(() => {
        fetchSettings()
            .then(setSettings)
            .catch(() => undefined);
        getStats()
            .then(setStats)
            .catch(() => undefined)
            .finally(() => setStatsLoading(false));
        getRecentLogs()
            .then(setLogs)
            .catch(() => undefined)
            .finally(() => setLogsLoading(false));
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    const sendQuery = useCallback(
        (query: string) => {
            if (loading || !query.trim()) return;
            setMessages(prev => [
                ...prev,
                { role: 'user', content: query },
                { role: 'assistant', content: '', streaming: true },
            ]);
            setInput('');
            setLoading(true);
            abortRef.current?.abort();
            abortRef.current = new AbortController();

            // Show "spinning up" hint if no token arrives within 5s (Ollama cold start)
            hasFirstToken.current = false;
            setSlowHint(false);
            if (slowHintTimer.current) clearTimeout(slowHintTimer.current);
            slowHintTimer.current = setTimeout(() => {
                if (!hasFirstToken.current) setSlowHint(true);
            }, 5000);

            handleQueryStream(
                query,
                chunk => {
                    hasFirstToken.current = true;
                    setSlowHint(false);
                    setMessages(prev => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last?.role === 'assistant')
                            next[next.length - 1] = { ...last, content: last.content + chunk };
                        return next;
                    });
                },
                () => {
                    setMessages(prev => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last?.role === 'assistant') next[next.length - 1] = { ...last, streaming: false };
                        return next;
                    });
                    setLoading(false);
                    setSlowHint(false);
                    if (slowHintTimer.current) clearTimeout(slowHintTimer.current);
                    abortRef.current = null;
                },
                (error: Error) => {
                    setMessages(prev => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last?.role === 'assistant')
                            next[next.length - 1] = {
                                ...last,
                                content: `**Error:** ${error.message || 'Request failed.'}`,
                                streaming: false,
                            };
                        return next;
                    });
                    setLoading(false);
                    setSlowHint(false);
                    if (slowHintTimer.current) clearTimeout(slowHintTimer.current);
                    abortRef.current = null;
                },
                abortRef.current.signal,
            );
        },
        [loading],
    );

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendQuery(input);
        }
    };

    const cancelRequest = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setLoading(false);
        setSlowHint(false);
        if (slowHintTimer.current) clearTimeout(slowHintTimer.current);
        setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant' && last.streaming)
                next[next.length - 1] = { ...last, content: last.content + '\n\n*(cancelled)*', streaming: false };
            return next;
        });
    };

    const successRate = stats?.all_time?.total_requests
        ? Math.round((stats.all_time.successful / stats.all_time.total_requests) * 100)
        : null;

    return (
        <div className={'space-y-4'}>
            {showLogsModal && <LogsModal onClose={() => setShowLogsModal(false)} />}
            {/* ── Connection status + stat cards ── */}
            <div className={'grid grid-cols-1 gap-3 sm:grid-cols-5'}>
                <div className={'sm:col-span-2'}>
                    <ConnectionCard settings={settings} />
                </div>
                <StatCard
                    label={'Requests (24h)'}
                    value={statsLoading ? '…' : (stats?.last_24h?.requests ?? 0)}
                    sub={`${statsLoading ? '…' : (stats?.last_24h?.tokens ?? 0).toLocaleString()} tokens`}
                />
                <StatCard
                    label={'Requests (7d)'}
                    value={statsLoading ? '…' : (stats?.last_7d?.requests ?? 0)}
                    sub={`${statsLoading ? '…' : (stats?.last_7d?.tokens ?? 0).toLocaleString()} tokens`}
                />
                <StatCard
                    label={'All-time'}
                    value={statsLoading ? '…' : (stats?.all_time?.total_requests ?? 0).toLocaleString()}
                    sub={
                        successRate !== null
                            ? `${successRate}% success · avg ${stats?.all_time?.avg_latency_ms ?? '?'}ms`
                            : undefined
                    }
                />
            </div>

            {/* ── Activity sparkline + top users ── */}
            {!statsLoading && stats && (
                <div className={'grid gap-3 sm:grid-cols-2'}>
                    <div
                        className={
                            'flex items-center justify-between rounded-xl border border-neutral-700/60 px-4 py-3'
                        }
                        style={{ backgroundColor: theme.colors.secondary }}
                    >
                        <div>
                            <p className={'mb-1 text-xs text-neutral-500'}>Activity — last 7 days</p>
                            <div className={'flex items-center gap-3'}>
                                <Sparkline series={stats.daily_series} />
                                <div className={'space-y-0.5 text-xs'}>
                                    <p>
                                        <span className={'text-neutral-500'}>Client</span>{' '}
                                        <span className={'font-medium text-neutral-200'}>
                                            {stats.source_breakdown['client'] ?? 0}
                                        </span>
                                    </p>
                                    <p>
                                        <span className={'text-neutral-500'}>Admin</span>{' '}
                                        <span className={'font-medium text-neutral-200'}>
                                            {stats.source_breakdown['admin'] ?? 0}
                                        </span>
                                    </p>
                                    <p>
                                        <span className={'text-neutral-500'}>Errors</span>{' '}
                                        <span className={'font-medium text-red-400'}>{stats.all_time.errors}</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div
                        className={'rounded-xl border border-neutral-700/60 px-4 py-3'}
                        style={{ backgroundColor: theme.colors.secondary }}
                    >
                        <p className={'mb-2 text-xs text-neutral-500'}>Top users (7d)</p>
                        {stats.top_users.length === 0 ? (
                            <p className={'text-xs text-neutral-600'}>No usage data yet</p>
                        ) : (
                            <div className={'space-y-1.5'}>
                                {stats.top_users.map((u, i) => (
                                    <div key={i} className={'flex items-center justify-between'}>
                                        <span className={'text-xs text-neutral-300'}>{u.username}</span>
                                        <span className={'font-mono text-xs text-neutral-500'}>{u.requests} req</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Recent request log ── */}
            <RecentLogsTable logs={logs} loading={logsLoading} onViewAll={() => setShowLogsModal(true)} />

            {/* ── Chat + config sidebar ── */}
            <div className={'grid gap-4 lg:grid-cols-5'}>
                <div className={'col-span-3 flex flex-col'}>
                    <div
                        className={'flex-1 overflow-y-auto rounded-xl p-4'}
                        style={{ minHeight: '28vh', maxHeight: '44vh', backgroundColor: theme.colors.secondary }}
                    >
                        {messages.map((msg, i) => (
                            <MessageBubble key={i} message={msg} />
                        ))}
                        <div ref={bottomRef} />
                    </div>
                    {slowHint && settings?.mode === 'ollama' && (
                        <p className={'mb-2 animate-pulse text-center text-xs text-neutral-500'}>
                            ⏳ Ollama is loading the model — this first response may take 20–60 seconds…
                        </p>
                    )}
                    <div
                        className={'mt-3 flex items-end gap-2 rounded-xl border border-neutral-700 px-4 py-3'}
                        style={{ backgroundColor: theme.colors.secondary }}
                    >
                        <textarea
                            ref={inputRef}
                            className={
                                'flex-1 resize-none bg-transparent text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none'
                            }
                            placeholder={'Ask M12Labs-AI anything… (Enter to send, Shift+Enter for newline)'}
                            rows={2}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={loading}
                        />
                        <div className={'flex flex-shrink-0 items-center gap-2'}>
                            {loading ? (
                                <>
                                    <Spinner size={'small'} />
                                    <Button variant={'secondary'} size={'sm'} onClick={cancelRequest}>
                                        Cancel
                                    </Button>
                                </>
                            ) : (
                                <Button size={'sm'} onClick={() => sendQuery(input)} disabled={input.trim().length < 1}>
                                    Send
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                <div className={'col-span-2 space-y-4'}>
                    <div
                        className={'rounded-xl border border-neutral-700 p-4'}
                        style={{ backgroundColor: theme.colors.secondary }}
                    >
                        <div className={'mb-3 flex items-center gap-2 text-sm font-medium text-neutral-200'}>
                            <SparklesIcon className={'h-4 w-4'} style={{ color: theme.colors.primary }} />
                            Configuration
                        </div>
                        <dl className={'space-y-1.5 text-xs'}>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Provider</dt>
                                <dd className={'font-medium text-neutral-200'}>
                                    {settings?.mode === 'ollama' ? 'Ollama' : 'OpenAI'}
                                </dd>
                            </div>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Model</dt>
                                <dd className={'font-mono text-neutral-200'}>{settings?.model || 'not set'}</dd>
                            </div>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Max tokens</dt>
                                <dd className={'text-neutral-200'}>{settings?.max_tokens ?? 500}</dd>
                            </div>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Temperature</dt>
                                <dd className={'text-neutral-200'}>{settings?.temperature ?? 0.3}</dd>
                            </div>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Server AI Assistant</dt>
                                <dd
                                    className={
                                        settings?.feature_server_assistant ? 'text-green-400' : 'text-neutral-400'
                                    }
                                >
                                    {settings?.feature_server_assistant ? 'Enabled' : 'Disabled'}
                                </dd>
                            </div>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Crash Analysis</dt>
                                <dd
                                    className={settings?.feature_crash_analysis ? 'text-green-400' : 'text-neutral-400'}
                                >
                                    {settings?.feature_crash_analysis ? 'Enabled' : 'Disabled'}
                                </dd>
                            </div>
                            <div className={'flex justify-between'}>
                                <dt className={'text-neutral-500'}>Admins</dt>
                                <dd className={'text-neutral-200'}>Always allowed</dd>
                            </div>
                        </dl>
                    </div>
                    <AdminBox title={'Disable M12Labs-AI'}>
                        Clicking the button below will disable M12Labs-AI for both clients and administrators. Your API
                        key will remain in the database unless you choose to delete it manually.
                        <div className={'mt-2 text-right'}>
                            <ToggleFeatureButton />
                        </div>
                    </AdminBox>
                    <p className={'text-xs text-neutral-500'}>
                        AI responses may be inaccurate. API usage is subject to your provider's rate limits and billing.
                    </p>
                </div>
            </div>
        </div>
    );
};
