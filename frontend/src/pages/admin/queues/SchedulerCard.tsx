import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import type { QueueScheduler } from '@/api/adminQueues';
import { formatMs } from './format';

/**
 * Cron, reported next to the workers that depend on it.
 *
 * The queue view cannot see this on its own, which is its one real blind spot:
 * if the scheduler stops, every lane stays clear and every worker stays green
 * while nothing scheduled happens at all. The recent-task list is also the only
 * visibility the panel has into scheduled work that runs inline rather than
 * dispatching a job -- most of the schedule, none of it otherwise on this page.
 *
 * Read-only by construction. There is no control here that can run, skip or
 * retry a scheduled task, and no endpoint behind the page that could.
 */
export function SchedulerCard({ scheduler }: { scheduler: QueueScheduler }) {
    const tone =
        scheduler.severity === 'down'
            ? 'danger'
            : scheduler.severity === 'stale' || scheduler.severity === 'unknown'
              ? 'warning'
              : 'accent';

    return (
        <article
            className={cn(
                'rounded-lg border bg-[var(--color-surface)] p-3.5',
                tone === 'danger'
                    ? 'border-[color-mix(in_oklab,var(--color-danger)_45%,var(--color-border-strong))]'
                    : tone === 'warning'
                      ? 'border-[color-mix(in_oklab,var(--color-warning)_40%,var(--color-border-strong))]'
                      : 'border-[var(--color-border-strong)]',
            )}
        >
            <header className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.scheduler.title']()}</h3>
                <span
                    className={cn(
                        'ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                        tone === 'danger'
                            ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                            : tone === 'warning'
                              ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                              : 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
                    )}
                >
                    {statusLabel(scheduler)}
                </span>
            </header>

            <p className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-faint)]">
                {m['admin.queues.scheduler.everyMinute']()}
                {scheduler.host && ` · ${scheduler.host}`}
            </p>

            {scheduler.severity === 'unknown' || scheduler.severity === 'down' ? (
                <div className="mt-3 rounded-r-md border-l-2 border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-[var(--color-ink)]">
                        {m['admin.queues.scheduler.missing']()}
                    </p>
                    <code className="mt-1.5 block overflow-x-auto whitespace-pre rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--color-ink-muted)]">
                        * * * * * php artisan schedule:run &gt;&gt; /dev/null 2&gt;&amp;1
                    </code>
                </div>
            ) : (
                <p className="mt-2.5 font-mono text-xs tabular-nums text-[var(--color-ink-muted)]">
                    {m['admin.queues.scheduler.lastRan']({ time: scheduler.ranAt ? timeAgo(scheduler.ranAt) : '—' })}
                </p>
            )}

            {scheduler.lastFailure && (
                <div className="mt-2.5 rounded-r-md border-l-2 border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-danger)]">
                        {m['admin.queues.scheduler.lastFailure']({ time: timeAgo(scheduler.lastFailure.ranAt) })}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-ink)]">{scheduler.lastFailure.task}</p>
                    <p className="mt-0.5 break-words font-mono text-[10px] text-[var(--color-ink-muted)]">
                        {scheduler.lastFailure.error}
                    </p>
                </div>
            )}

            {scheduler.recent.length > 0 && (
                <>
                    <div className="mb-1.5 mt-3 flex items-center gap-2.5">
                        <span className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                            {m['admin.queues.scheduler.recent']()}
                        </span>
                        <span className="h-px flex-1 bg-[var(--color-border)]" />
                    </div>
                    <ul className="space-y-1">
                        {scheduler.recent.map(task => (
                            <li key={task.task} className="flex items-baseline gap-2 text-[11px]">
                                <span
                                    className={cn(
                                        'h-1.5 w-1.5 shrink-0 rounded-full',
                                        task.ok ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-danger)]',
                                    )}
                                    aria-hidden="true"
                                />
                                <span className="truncate text-[var(--color-ink-muted)]">{task.task}</span>
                                <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-ink-faint)]">
                                    {formatMs(task.runtimeMs)} · {timeAgo(task.ranAt)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </article>
    );
}

function statusLabel(scheduler: QueueScheduler): string {
    switch (scheduler.severity) {
        case 'down':
            return m['admin.queues.scheduler.down']();
        case 'stale':
            return m['admin.queues.scheduler.stale']();
        case 'unknown':
            return m['admin.queues.scheduler.unknown']();
        default:
            return m['admin.queues.scheduler.ok']();
    }
}
