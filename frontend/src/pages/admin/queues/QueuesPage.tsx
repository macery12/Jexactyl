import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleSlash, Cpu, ListOrdered, XCircle } from 'lucide-react';
import { m } from '@/i18n';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { getQueueHealth, type QueueHealth, type QueueLane, type QueueWarning } from '@/api/adminQueues';

const panel = 'rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60';

function formatMs(value: number | null): string {
    // Horizon reports 0 for "never measured", which would read as "instant".
    if (value === null || value <= 0) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function WarningRow({ warning }: { warning: QueueWarning }) {
    const critical = warning.severity === 'critical';
    const Icon = critical ? XCircle : AlertTriangle;

    return (
        <li
            className={cn(
                'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
                critical
                    ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                    : 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
            )}
        >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-[var(--color-ink)]">{warning.message}</span>
        </li>
    );
}

/**
 * Whether a lane is being drained is the single most useful cell here: it
 * separates "slow" from "nothing is listening", which look identical from a
 * queue depth alone.
 */
function ConsumerCell({ lane }: { lane: QueueLane }) {
    if (lane.consumed) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[var(--color-success)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {m['admin.queues.consumer.yes']()}
            </span>
        );
    }

    // A lane whose module is switched off is correctly unstaffed, not broken.
    if (!lane.expected) {
        return (
            <span className="inline-flex items-center gap-1.5 text-[var(--color-ink-faint)]">
                <CircleSlash className="h-3.5 w-3.5" />
                {m['admin.queues.consumer.na']()}
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-danger)]">
            <XCircle className="h-3.5 w-3.5" />
            {m['admin.queues.consumer.none']()}
        </span>
    );
}

function StatusPill({ data }: { data: QueueHealth }) {
    const { running, paused } = data.horizon;

    const tone = !running
        ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
        : paused
          ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
          : 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]';

    const label = !running
        ? m['admin.queues.status.stopped']()
        : paused
          ? m['admin.queues.status.paused']()
          : m['admin.queues.status.running']();

    return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', tone)}>{label}</span>;
}

export default function QueuesPage() {
    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'queues'],
        queryFn: getQueueHealth,
        refetchInterval: 15_000,
    });

    if (isLoading || !data) {
        return (
            <div className="flex justify-center py-16">
                <Spinner />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold text-[var(--color-ink)]">{m['admin.queues.title']()}</h1>
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.queues.subtitle']()}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusPill data={data} />
                    <span className="text-xs text-[var(--color-ink-faint)]">
                        {m['admin.queues.updated']({ time: timeAgo(data.generatedAt) })}
                    </span>
                </div>
            </header>

            {data.warnings.length > 0 ? (
                <ul className="space-y-2">
                    {data.warnings.map((warning, index) => (
                        <WarningRow key={`${warning.code}-${index}`} warning={warning} />
                    ))}
                </ul>
            ) : (
                <p className="flex items-center gap-2 rounded-md border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-3 py-2.5 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success)]" />
                    {m['admin.queues.healthy']()}
                </p>
            )}

            <section className={cn(panel, 'overflow-hidden')}>
                <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
                    <ListOrdered className="h-4 w-4 text-[var(--color-ink-muted)]" />
                    <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.lanes.title']()}</h2>
                    {data.metricsWindowMinutes !== null && (
                        <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                            {m['admin.queues.metricsWindow']({ minutes: data.metricsWindowMinutes })}
                        </span>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[54rem] text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                            <tr className="border-b border-[var(--color-border)]">
                                <th className="px-4 py-2 font-medium">{m['admin.queues.col.lane']()}</th>
                                <th className="px-4 py-2 font-medium">{m['admin.queues.col.consumer']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.depth']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.wait']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.processed']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.runtime']()}</th>
                                <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.retryAfter']()}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.lanes.map((lane) => (
                                <tr key={lane.lane} className="border-b border-[var(--color-border)] last:border-0">
                                    <td className="px-4 py-2.5">
                                        <span className="font-medium text-[var(--color-ink)]">{lane.lane}</span>
                                        <span className="ml-2 font-mono text-xs text-[var(--color-ink-faint)]">
                                            {lane.connection}:{lane.queue}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <ConsumerCell lane={lane} />
                                    </td>
                                    <td
                                        className={cn(
                                            'px-4 py-2.5 text-right font-mono tabular-nums',
                                            (lane.depth ?? 0) > 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]',
                                        )}
                                    >
                                        {lane.depth ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                        {lane.waitSeconds === null ? '—' : `${lane.waitSeconds}s`}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                        {lane.processed ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                        {formatMs(lane.avgRuntimeMs)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--color-ink-faint)]">
                                        {lane.retryAfter === null ? '—' : `${lane.retryAfter}s`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
                <section className={cn(panel, 'p-4')}>
                    <div className="mb-3 flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-[var(--color-ink-muted)]" />
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.workers.title']()}</h2>
                    </div>
                    {data.workers.length === 0 ? (
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.queues.workers.none']()}</p>
                    ) : (
                        <ul className="space-y-2 text-sm">
                            {data.workers.map((worker) => (
                                <li key={`${worker.host}-${worker.pid}`} className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="font-mono text-[var(--color-ink)]">
                                        {worker.host}:{worker.pid}
                                    </span>
                                    <span className="text-xs text-[var(--color-ink-muted)]">{worker.queues.join(', ')}</span>
                                    <span className="ml-auto text-xs text-[var(--color-ink-faint)]">{timeAgo(worker.seenAt)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {data.horizon.supervisors.length > 0 && (
                        <ul className="mt-3 space-y-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-ink-muted)]">
                            {data.horizon.supervisors.map((supervisor) => (
                                <li key={supervisor.name}>
                                    {m['admin.queues.supervisor.line']({
                                        name: supervisor.name ?? '?',
                                        status: supervisor.status ?? '?',
                                        processes: supervisor.processes,
                                    })}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className={cn(panel, 'p-4')}>
                    <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.failed.title']()}</h2>
                    {data.failed.total === null ? (
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.queues.failed.unavailable']()}</p>
                    ) : (
                        <>
                            <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-ink)]">{data.failed.total}</p>
                            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                                {m['admin.queues.failed.lastDay']({ count: data.failed.lastDay ?? 0 })}
                            </p>
                            {data.failed.oldestFailedAt && (
                                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                                    {m['admin.queues.failed.oldest']({ time: timeAgo(data.failed.oldestFailedAt) })}
                                </p>
                            )}
                        </>
                    )}
                </section>
            </div>

            {data.jobs.length > 0 && (
                <section className={cn(panel, 'overflow-hidden')}>
                    <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.jobs.title']()}</h2>
                        {data.metricsWindowMinutes !== null && (
                            <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                                {m['admin.queues.metricsWindow']({ minutes: data.metricsWindowMinutes })}
                            </span>
                        )}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[32rem] text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                                <tr className="border-b border-[var(--color-border)]">
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.col.job']()}</th>
                                    <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.processed']()}</th>
                                    <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.runtime']()}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.jobs.slice(0, 15).map((job) => (
                                    <tr key={job.job} className="border-b border-[var(--color-border)] last:border-0">
                                        <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink)]">{job.job}</td>
                                        <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                            {job.processed ?? '—'}
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                            {formatMs(job.avgRuntimeMs)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
}
