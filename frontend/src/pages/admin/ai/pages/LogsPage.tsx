import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { m } from '@/i18n';
import { Panel } from '@/components/ui/Panel';
import { Select } from '@/components/ui/Select';
import { getAiLogs, type AiLogsParams } from '@/api/adminAi';
import { LogTable } from './LogTable';
import { AI_SOURCES, sourceLabel } from '../sources';
import { AiLoadError } from '../LoadError';

// Full request log — search by user, filter by source/status, newest 500.
export default function LogsPage() {
    const [source, setSource] = useState<NonNullable<AiLogsParams['source']>>('');
    const [status, setStatus] = useState<NonNullable<AiLogsParams['status']>>('');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    const handleSearch = (value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSearch(value), 400);
    };

    const { data: logs = [], isLoading, isError, refetch } = useQuery({
        queryKey: ['admin', 'ai', 'logs', { source, status, search }],
        queryFn: () => getAiLogs({ limit: 500, source, status, search: search || undefined }),
    });

    return (
        <Panel
            title={m['admin.ai.logs.title']()}
            right={
                <span className="text-xs tabular-nums text-[var(--color-ink-faint)]">
                    {isError ? '—' : isLoading ? '…' : m['admin.ai.logs.recordCount']({ count: logs.length })}
                </span>
            }
            flush
        >
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
                <div className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2.5">
                    <Search className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => handleSearch(e.target.value)}
                        placeholder={m['admin.ai.logs.searchPlaceholder']()}
                        className="w-44 bg-transparent text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
                    />
                    {searchInput && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchInput('');
                                setSearch('');
                            }}
                            className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
                <Select
                    value={source || 'all'}
                    onChange={v => setSource(v === 'all' ? '' : (v as NonNullable<AiLogsParams['source']>))}
                    options={[
                        { value: 'all', label: m['admin.ai.logs.allSources']() },
                        ...AI_SOURCES.map(entry => ({ value: entry, label: sourceLabel(entry) })),
                    ]}
                    className="h-9 w-44 text-xs"
                />
                <Select
                    value={status || 'all'}
                    onChange={v => setStatus(v === 'all' ? '' : (v as NonNullable<AiLogsParams['status']>))}
                    options={[
                        { value: 'all', label: m['admin.ai.logs.allStatuses']() },
                        { value: 'success', label: m['admin.ai.logs.statusSuccess']() },
                        { value: 'error', label: m['admin.ai.logs.statusError']() },
                        { value: 'running', label: m['admin.ai.logs.statusRunning']() },
                        { value: 'suspended', label: m['admin.ai.logs.statusSuspended']() },
                        { value: 'cancelled', label: m['admin.ai.logs.statusCancelled']() },
                    ]}
                    className="h-9 w-36 text-xs"
                />
            </div>
            {isError ? (
                <AiLoadError onRetry={() => void refetch()} />
            ) : (
                <LogTable logs={logs} loading={isLoading} />
            )}
        </Panel>
    );
}
