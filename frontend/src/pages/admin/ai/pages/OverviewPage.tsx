import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, XCircle, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { m } from '@/i18n/messages';
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
import { sourceChip, sourceLabel, sourceTone } from '../sources';
import { AiLoadError } from '../LoadError';

// A labelled figure on one dense line.
//
// Deliberately not a big-numeral tile: a row of those is the revenue-dashboard
// idiom, and this page is an ops readout for a service whose interesting
// numbers are distributions rather than totals. The figure is mono and
// tabular so a column of them lines up and can be scanned.
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)]/60 py-1.5 last:border-0">
            <span className="text-xs text-[var(--color-ink-faint)]">{label}</span>
            <span className="text-right">
                <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">{value}</span>
                {sub && <span className="ml-1.5 text-[11px] text-[var(--color-ink-faint)]">{sub}</span>}
            </span>
        </div>
    );
}

// One bucket of the latency spread. Width is share of the window's requests,
// so an install whose turns are mostly fast reads as a single wide bar at the
// top and a stub at the bottom.
function LatencyBar({ label, count, total, warn }: { label: string; count: number; total: number; warn?: boolean }) {
    const share = total > 0 ? count / total : 0;

    return (
        <div className="flex items-center gap-2.5">
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-[var(--color-ink-faint)]">{label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                    className={cn(
                        'h-full rounded-full transition-all',
                        warn ? 'bg-[var(--color-warning)]' : 'bg-[var(--brand)]/70',
                    )}
                    style={{ width: `${Math.max(share * 100, count > 0 ? 3 : 0)}%` }}
                />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                {count}
            </span>
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
    const { data: conn, isFetching, isError: connectionError } = useQuery({
        queryKey: ['admin', 'ai', 'health'],
        queryFn: () => testAiConnection(false),
        staleTime: 60_000,
    });

    const retest = useMutation({
        mutationFn: () => testAiConnection(true),
        onSuccess: fresh => queryClient.setQueryData(['admin', 'ai', 'health'], fresh),
    });
    const testing = isFetching || retest.isPending;
    const testFailed = connectionError || retest.isError;

    const providerLabel =
        settings?.provider === 'ollama'
            ? m['admin.ai.providerOllama']()
            : settings?.provider === 'openrouter'
              ? m['admin.ai.providerOpenrouter']()
            : settings?.provider === 'anthropic'
              ? m['admin.ai.providerAnthropic']()
              : settings?.provider === 'openai_compatible'
                ? m['admin.ai.providerCompatible']()
                : m['admin.ai.providerOpenai']();

    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
                {testing ? (
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
                        {testFailed ? (
                            <span className="text-[var(--color-danger)]">{m['common.states.genericError']()}</span>
                        ) : conn?.status === 'ok' ? (
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
                onClick={() => retest.mutate()}
                disabled={testing}
                title={m['admin.ai.overview.retest']()}
                className="shrink-0 rounded-lg border border-[var(--color-border-strong)] p-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
            >
                <RefreshCw className={cn('h-4 w-4', testing && 'animate-spin')} />
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
    const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery({
        queryKey: ['admin', 'ai', 'stats'],
        queryFn: getAiStats,
    });
    const { data: logs = [], isLoading: logsLoading, isError: logsError, refetch: refetchLogs } = useQuery({
        queryKey: ['admin', 'ai', 'logs', 'recent'],
        queryFn: () => getAiLogs({ limit: 10 }),
    });

    const { data: settings } = useQuery({ queryKey: ['admin', 'ai', 'settings'], queryFn: getAiSettings });

    const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
    const secs = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);

    const latency = stats?.latency;
    const latencyTotal = latency
        ? latency.under_1s + latency.to_5s + latency.to_15s + latency.to_60s + latency.over_60s
        : 0;

    // Sorted by volume so the dominant source leads, rather than by a fixed
    // order that buries whatever is actually running.
    const sources = Object.entries(stats?.source_breakdown ?? {})
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a);

    const budget = settings?.budget;
    const budgetShare =
        budget?.enforce && budget.monthly_tokens > 0
            ? Math.min((stats?.month_to_date_tokens ?? 0) / budget.monthly_tokens, 1)
            : null;

    if (statsError) {
        return (
            <div className="space-y-3">
                <ConnectionCard />
                <AiLoadError onRetry={() => void refetchStats()} />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <ConnectionCard />

            <div className="grid gap-3 xl:grid-cols-3">
                <Panel title={m['admin.ai.overview.activityTitle']()}>
                    <div className="space-y-3">
                        <div className="flex items-end justify-between gap-4">
                            <ActivityBars series={stats?.daily_series ?? []} />
                            <div className="text-right">
                                <p className="font-mono text-lg tabular-nums leading-none text-[var(--color-ink)]">
                                    {statsLoading ? '…' : fmt(stats?.last_7d.requests)}
                                </p>
                                <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                                    {m['admin.ai.overview.turns7d']()}
                                </p>
                            </div>
                        </div>

                        <div>
                            {sources.map(([source, count]) => (
                                <div
                                    key={source}
                                    className="flex items-center justify-between gap-3 border-b border-[var(--color-border)]/60 py-1.5 last:border-0"
                                >
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                            sourceChip[sourceTone(source)],
                                        )}
                                    >
                                        {sourceLabel(source)}
                                    </span>
                                    <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">
                                        {fmt(count)}
                                    </span>
                                </div>
                            ))}
                            {sources.length === 0 && (
                                <p className="py-3 text-center text-xs text-[var(--color-ink-faint)]">
                                    {m['admin.ai.overview.noUsage']()}
                                </p>
                            )}
                        </div>
                    </div>
                </Panel>

                <Panel
                    title={m['admin.ai.overview.latencyTitle']()}
                    right={
                        <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                            {m['admin.ai.overview.avgLabel']({ value: secs(latency?.avg_ms) })}
                        </span>
                    }
                >
                    {latencyTotal === 0 ? (
                        <p className="py-3 text-center text-xs text-[var(--color-ink-faint)]">
                            {m['admin.ai.overview.noUsage']()}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            <LatencyBar label="< 1s" count={latency?.under_1s ?? 0} total={latencyTotal} />
                            <LatencyBar label="1–5s" count={latency?.to_5s ?? 0} total={latencyTotal} />
                            <LatencyBar label="5–15s" count={latency?.to_15s ?? 0} total={latencyTotal} />
                            <LatencyBar label="15–60s" count={latency?.to_60s ?? 0} total={latencyTotal} />
                            <LatencyBar label="> 60s" count={latency?.over_60s ?? 0} total={latencyTotal} warn />
                            <p className="pt-1 text-[11px] text-[var(--color-ink-faint)]">
                                {m['admin.ai.overview.slowest']({ value: secs(latency?.slowest_ms) })}
                            </p>
                        </div>
                    )}
                </Panel>

                <Panel title={m['admin.ai.overview.costTitle']()}>
                    <div>
                        <Metric
                            label={m['admin.ai.overview.tokensIn']()}
                            value={fmt(stats?.last_7d.prompt_tokens)}
                        />
                        <Metric
                            label={m['admin.ai.overview.tokensOut']()}
                            value={fmt(stats?.last_7d.completion_tokens)}
                        />
                        <Metric
                            label={m['admin.ai.overview.cacheHitsLabel']()}
                            value={fmt(stats?.last_7d.cache_hits)}
                        />
                        <Metric
                            label={m['admin.ai.overview.errorsLabel']()}
                            value={fmt(stats?.last_7d.errors)}
                        />
                        <Metric
                            label={m['admin.ai.overview.monthToDate']()}
                            value={fmt(stats?.month_to_date_tokens)}
                        />
                    </div>

                    {budgetShare !== null ? (
                        <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="text-[var(--color-ink-faint)]">
                                    {m['admin.ai.overview.budgetLabel']()}
                                </span>
                                <span className="font-mono tabular-nums text-[var(--color-ink-muted)]">
                                    {Math.round(budgetShare * 100)}%
                                </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                                <div
                                    className={cn(
                                        'h-full rounded-full transition-all',
                                        budgetShare >= 0.9 ? 'bg-[var(--color-warning)]' : 'bg-[var(--brand)]',
                                    )}
                                    style={{ width: `${budgetShare * 100}%` }}
                                />
                            </div>
                        </div>
                    ) : (
                        <Link
                            to="/admin/ai/limits"
                            className="mt-3 block text-[11px] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                        >
                            {m['admin.ai.overview.budgetOff']()}
                        </Link>
                    )}
                </Panel>
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
                <div className="xl:col-span-2">
                    <InferenceCard />
                </div>
                <Panel title={m['admin.ai.overview.topUsers']()}>
                    {(stats?.top_users.length ?? 0) === 0 ? (
                        <p className="py-3 text-center text-xs text-[var(--color-ink-faint)]">
                            {m['admin.ai.overview.noUsage']()}
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {stats?.top_users.map(user => (
                                <div key={user.username} className="flex items-center justify-between gap-3">
                                    <span className="truncate text-xs text-[var(--color-ink)]">{user.username}</span>
                                    <span className="font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                                        {m['admin.ai.overview.requestCount']({ count: String(user.requests) })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Panel>
            </div>

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
                {logsError ? (
                    <AiLoadError onRetry={() => void refetchLogs()} />
                ) : (
                    <LogTable logs={logs} loading={logsLoading} />
                )}
            </Panel>
        </div>
    );
}
