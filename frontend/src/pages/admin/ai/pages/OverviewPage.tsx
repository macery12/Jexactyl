import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, XCircle, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Spinner';
import {
    getAiInference,
    getAiLogs,
    getAiSettings,
    getAiStats,
    testAiConnection,
    type AiStats,
} from '@/api/adminAi';
import { LogTable } from './LogTable';

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="flex flex-col gap-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                {label}
            </span>
            <span className="text-xl font-semibold tabular-nums text-[var(--color-ink)]">{value}</span>
            {sub && <span className="text-xs text-[var(--color-ink-faint)]">{sub}</span>}
        </div>
    );
}

// 7-day request volume as thin hoverable bars — single series in the brand
// hue, recessive (no axes/grid), each day carrying a native tooltip.
function ActivityBars({ series }: { series: AiStats['daily_series'] }) {
    const max = Math.max(...series.map(day => day.requests), 1);
    return (
        <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={m['admin.ai.overview.activityLabel']()}>
            {series.map(day => (
                <div
                    key={day.date}
                    title={`${new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${day.requests}`}
                    className="group flex h-full w-6 items-end"
                >
                    <div
                        className="w-full rounded-t-[4px] bg-[var(--brand)]/60 transition-colors group-hover:bg-[var(--brand)]"
                        style={{ height: `${Math.max((day.requests / max) * 100, day.requests > 0 ? 6 : 2)}%` }}
                    />
                </div>
            ))}
        </div>
    );
}

function ConnectionCard() {
    const queryClient = useQueryClient();
    const { data: settings } = useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: getAiSettings });
    const { data: conn, isFetching } = useQuery({
        queryKey: ['admin', 'ai', 'health'],
        queryFn: () => testAiConnection(false),
        staleTime: 60_000,
    });

    const retest = async () => {
        const fresh = await testAiConnection(true);
        queryClient.setQueryData(['admin', 'ai', 'health'], fresh);
    };

    const providerLabel =
        settings?.provider === 'ollama'
            ? m['admin.ai.providerOllama']()
            : settings?.provider === 'anthropic'
              ? m['admin.ai.providerAnthropic']()
              : settings?.provider === 'openai_compatible'
                ? m['admin.ai.providerCompatible']()
                : m['admin.ai.providerOpenai']();

    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
                {isFetching ? (
                    <Spinner className="h-5 w-5 shrink-0" />
                ) : conn?.status === 'ok' ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
                ) : (
                    <XCircle className="h-5 w-5 shrink-0 text-[var(--color-danger)]" />
                )}
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                        {providerLabel} · <span className="font-mono text-xs">{settings?.model || '—'}</span>
                    </p>
                    <p className="truncate text-xs text-[var(--color-ink-faint)]">{settings?.endpoint || '—'}</p>
                    <p className="mt-0.5 text-xs">
                        {conn?.status === 'ok' ? (
                            <span className="text-[var(--color-accent)]">
                                {m['admin.ai.overview.connected']({ latency: String(conn.latency_ms ?? '?') })}
                            </span>
                        ) : conn ? (
                            <span className="text-[var(--color-danger)]">{conn.message ?? m['common.states.genericError']()}</span>
                        ) : (
                            <span className="text-[var(--color-ink-faint)]">{m['admin.ai.overview.testing']()}</span>
                        )}
                        {settings?.warm && settings.provider === 'ollama' && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-warning)]">
                                <Zap className="h-3 w-3" />
                                {m['admin.ai.overview.warmOn']()}
                            </span>
                        )}
                    </p>
                </div>
            </div>
            <button
                type="button"
                onClick={() => void retest()}
                disabled={isFetching}
                title={m['admin.ai.overview.retest']()}
                className="shrink-0 rounded-lg border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
            >
                <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </button>
        </div>
    );
}

// Live state of the inference backend.
//
// Three numbers decide whether the agent is usable at all: whether the model
// can call tools, how many turns can run at once, and how many are waiting.
// Grouping them beats scattering them across settings and a connection test.
function InferenceCard() {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'ai', 'inference'],
        queryFn: getAiInference,
        refetchInterval: 15_000,
        retry: false,
    });

    if (isLoading) {
        return (
            <Panel title={m['admin.ai.overview.inference']()}>
                <div className="flex justify-center py-6">
                    <Spinner className="h-5 w-5" />
                </div>
            </Panel>
        );
    }

    if (isError || !data) {
        return (
            <Panel title={m['admin.ai.overview.inference']()}>
                <p className="py-4 text-center text-xs text-[var(--color-ink-faint)]">
                    {m['admin.ai.overview.inferenceUnavailable']()}
                </p>
            </Panel>
        );
    }

    const { queue, capabilities } = data;
    const load = queue.slots > 0 ? Math.min(queue.slots_in_use / queue.slots, 1) : 0;

    return (
        <Panel title={m['admin.ai.overview.inference']()}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    {capabilities?.supports_tools ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                    ) : (
                        <XCircle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">
                        {capabilities?.supports_tools
                            ? m['admin.ai.overview.toolsSupported']({ model: capabilities.model })
                            : m['admin.ai.overview.toolsUnsupported']()}
                    </span>
                </div>

                {queue.applies ? (
                    <>
                        <div>
                            <div className="mb-1 flex items-center justify-between text-xs">
                                <span className="text-[var(--color-ink-muted)]">
                                    {m['admin.ai.overview.slots']()}
                                </span>
                                <span className="font-mono tabular-nums text-[var(--color-ink)]">
                                    {queue.slots_in_use} / {queue.slots}
                                </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                                <div
                                    className={cn(
                                        'h-full rounded-full transition-all',
                                        load >= 1 ? 'bg-[var(--color-warning)]' : 'bg-[var(--brand)]',
                                    )}
                                    style={{ width: `${load * 100}%` }}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5">
                                <p className="text-[var(--color-ink-faint)]">{m['admin.ai.overview.waiting']()}</p>
                                <p className="font-mono tabular-nums text-[var(--color-ink)]">{queue.queue_depth}</p>
                            </div>
                            <div className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5">
                                <p className="text-[var(--color-ink-faint)]">{m['admin.ai.overview.avgTurn']()}</p>
                                <p className="font-mono tabular-nums text-[var(--color-ink)]">
                                    {(data.average_turn_ms / 1000).toFixed(1)}s
                                </p>
                            </div>
                        </div>
                    </>
                ) : (
                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.ai.overview.queueNotApplicable']()}</p>
                )}

                {data.resident_models.length > 0 && (
                    <div>
                        <p className="mb-1 text-xs text-[var(--color-ink-faint)]">
                            {m['admin.ai.overview.residentModels']()}
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {data.resident_models.map((model, index) => (
                                <span
                                    key={model.name ?? model.model ?? index}
                                    className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink-muted)]"
                                >
                                    {model.name ?? model.model ?? '—'}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Panel>
    );
}

export default function OverviewPage() {
    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['admin', 'ai', 'stats'],
        queryFn: getAiStats,
    });
    const { data: logs = [], isLoading: logsLoading } = useQuery({
        queryKey: ['admin', 'ai', 'logs', 'recent'],
        queryFn: () => getAiLogs({ limit: 10 }),
    });

    const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
    const successRate = stats?.all_time.total_requests
        ? Math.round((stats.all_time.successful / stats.all_time.total_requests) * 100)
        : null;

    return (
        <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-3">
                    <ConnectionCard />
                    <InferenceCard />
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <StatTile
                        label={m['admin.ai.overview.requests24h']()}
                        value={statsLoading ? '…' : fmt(stats?.last_24h.requests)}
                        sub={m['admin.ai.overview.tokens']({ count: fmt(stats?.last_24h.tokens) })}
                    />
                    <StatTile
                        label={m['admin.ai.overview.requests7d']()}
                        value={statsLoading ? '…' : fmt(stats?.last_7d.requests)}
                        sub={m['admin.ai.overview.cacheHits']({ count: fmt(stats?.last_7d.cache_hits) })}
                    />
                    <StatTile
                        label={m['admin.ai.overview.allTime']()}
                        value={statsLoading ? '…' : fmt(stats?.all_time.total_requests)}
                        sub={
                            successRate !== null
                                ? m['admin.ai.overview.successRate']({
                                      rate: String(successRate),
                                      latency: fmt(stats?.all_time.avg_latency_ms),
                                  })
                                : undefined
                        }
                    />
                </div>
            </div>

            {stats && (
                <div className="grid gap-3 lg:grid-cols-2">
                    <Panel title={m['admin.ai.overview.activityTitle']()}>
                        <div className="flex items-end justify-between gap-4">
                            <ActivityBars series={stats.daily_series} />
                            <dl className="space-y-1 text-xs">
                                <div className="flex justify-between gap-6">
                                    <dt className="text-[var(--color-ink-faint)]">{m['admin.ai.overview.sourceClient']()}</dt>
                                    <dd className="font-medium tabular-nums text-[var(--color-ink)]">
                                        {fmt(stats.source_breakdown['client'])}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-6">
                                    <dt className="text-[var(--color-ink-faint)]">{m['admin.ai.overview.sourceAdmin']()}</dt>
                                    <dd className="font-medium tabular-nums text-[var(--color-ink)]">
                                        {fmt(stats.source_breakdown['admin'])}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-6">
                                    <dt className="text-[var(--color-ink-faint)]">{m['admin.ai.overview.errors']()}</dt>
                                    <dd className="font-medium tabular-nums text-[var(--color-danger)]">
                                        {fmt(stats.all_time.errors)}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </Panel>
                    <Panel title={m['admin.ai.overview.topUsers']()}>
                        {stats.top_users.length === 0 ? (
                            <p className="py-3 text-center text-xs text-[var(--color-ink-faint)]">
                                {m['admin.ai.overview.noUsage']()}
                            </p>
                        ) : (
                            <div className="space-y-1.5">
                                {stats.top_users.map(u => (
                                    <div key={u.username} className="flex items-center justify-between">
                                        <span className="truncate text-xs text-[var(--color-ink)]">{u.username}</span>
                                        <span className="font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                                            {m['admin.ai.overview.requestCount']({ count: String(u.requests) })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>
            )}

            <Panel
                title={m['admin.ai.overview.recentTitle']()}
                right={
                    <Link
                        to="/admin/ai/logs"
                        className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                    >
                        {m['admin.ai.overview.viewAll']()}
                    </Link>
                }
                flush
            >
                <LogTable logs={logs} loading={logsLoading} />
            </Panel>
        </div>
    );
}
