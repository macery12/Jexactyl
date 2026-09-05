import { m } from '@/i18n/messages';
import type { QueueJobMetric } from '@/api/adminQueues';
import { formatMs } from './format';

/**
 * Which job classes are actually doing the work.
 *
 * Horizon measures by class, so this is where an operator finds out that one
 * job is responsible for a lane's whole runtime. Names come from the catalogue
 * in config/queue.php; the class stays on the row underneath, because that is
 * what you grep the log for.
 */
export function JobTypesPanel({ jobs, windowMinutes }: { jobs: QueueJobMetric[]; windowMinutes: number | null }) {
    if (jobs.length === 0) {
        return (
            <p className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 px-4 py-6 text-sm text-[var(--color-ink-muted)]">
                {m['admin.queues.jobs.none']()}
            </p>
        );
    }

    return (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
                <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.jobs.title']()}</h2>
                {windowMinutes !== null && (
                    <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                        {m['admin.queues.metricsWindow']({ minutes: windowMinutes })}
                    </span>
                )}
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                        <tr className="border-b border-[var(--color-border)]">
                            <th className="px-4 py-2 font-medium">{m['admin.queues.col.job']()}</th>
                            <th className="px-4 py-2 font-medium">{m['admin.queues.col.lane']()}</th>
                            <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.processed']()}</th>
                            <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.runtime']()}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {jobs.map(job => (
                            <tr key={job.job} className="border-b border-[var(--color-border)] last:border-0">
                                <td className="px-4 py-2.5">
                                    <div className="font-medium text-[var(--color-ink)]">{job.title}</div>
                                    <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">{job.job}</div>
                                    {job.summary && (
                                        <div className="mt-0.5 max-w-[46ch] text-xs text-[var(--color-ink-muted)]">{job.summary}</div>
                                    )}
                                </td>
                                <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-ink-muted)]">
                                    {job.lane ?? '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                    {job.processed ?? '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--color-ink-muted)]">
                                    {formatMs(job.avgRuntimeMs)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
