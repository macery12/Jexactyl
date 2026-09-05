import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import type { QueuePool, QueueProcess, QueueScheduler } from '@/api/adminQueues';
import { formatDuration } from './format';
import { SchedulerCard } from './SchedulerCard';

/**
 * Worker processes, grouped under the supervisor that owns them.
 *
 * The flat host:pid list this replaces was the most confusing thing on the
 * page: six rows look like six problems when they are one healthy supervisor
 * running six processes. Each pool is named for the work it does rather than
 * for its config key, the processes are pips instead of rows, and the raw PIDs
 * sit behind a disclosure -- present for anyone who needs to kill one, absent
 * for everyone who does not.
 */
export function WorkerPools({
    pools,
    running,
    scheduler,
}: {
    pools: QueuePool[];
    running: boolean;
    scheduler: QueueScheduler;
}) {
    return (
        <div className="space-y-3">
            {/* Cron sits beside the workers because it is the other thing that
                runs work, and because it is the half the queue cannot see: if it
                stops, every pool below stays green while nothing is fed to it. */}
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                <SchedulerCard scheduler={scheduler} />
                {pools.map(pool => (
                    <PoolCard key={pool.name} pool={pool} running={running} />
                ))}
            </div>

            {pools.length === 0 && (
                <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-6 text-sm text-[var(--color-ink)]">
                    {m['admin.queues.workers.none']()}
                </p>
            )}
        </div>
    );
}

function PoolCard({ pool, running }: { pool: QueuePool; running: boolean }) {
    const [open, setOpen] = useState(false);

    // A pool with no processes is only a fault when it was meant to have some.
    // The mods supervisor sized to zero because the module is off is correct,
    // and drawing it as an outage is how a page teaches people to ignore it.
    const starved = pool.expected && pool.processCount === 0;
    const tone = starved ? 'danger' : pool.busyCount > 0 ? 'warning' : 'accent';

    return (
        <article
            className={cn(
                'rounded-lg border bg-[var(--color-surface)] p-3.5',
                starved
                    ? 'border-[color-mix(in_oklab,var(--color-danger)_45%,var(--color-border-strong))]'
                    : 'border-[var(--color-border-strong)]',
                !pool.expected && pool.processCount === 0 && 'opacity-60',
            )}
        >
            <header className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{pool.title}</h3>
                <span
                    className={cn(
                        'ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                        starved
                            ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                            : tone === 'warning'
                              ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                              : 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
                    )}
                >
                    {statusLabel(pool, running, starved)}
                </span>
            </header>

            <p className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-faint)]">
                {pool.name}
                {pool.connection && ` · ${pool.connection}`}
            </p>

            <div className="mt-3 flex items-center gap-2">
                <Pips pool={pool} />
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                    {pool.maxProcesses !== null && pool.maxProcesses > 0
                        ? m['admin.queues.pool.ofMax']({ count: pool.processCount, max: pool.maxProcesses })
                        : m['admin.queues.pool.processes']({ count: pool.processCount })}
                </span>
            </div>

            {pool.summary && <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">{pool.summary}</p>}

            {pool.lanes.length > 0 && (
                <p className="mt-2 font-mono text-[10px] text-[var(--color-ink-faint)]">{pool.lanes.join(' · ')}</p>
            )}

            <BusyLines processes={pool.processes} />

            {pool.processes.length > 0 && (
                <>
                    <button
                        type="button"
                        onClick={() => setOpen(value => !value)}
                        aria-expanded={open}
                        className="mt-2.5 inline-flex items-center gap-1 font-mono text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
                    >
                        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                        {m['admin.queues.pool.pids']()}
                    </button>

                    {open && (
                        <ul className="mt-1.5 space-y-1 border-t border-[var(--color-border)] pt-1.5">
                            {pool.processes.map(process => (
                                <li
                                    key={`${process.host}-${process.pid}`}
                                    className="flex items-baseline gap-2 font-mono text-[10px] text-[var(--color-ink-faint)]"
                                >
                                    <span className="text-[var(--color-ink-muted)]">
                                        {process.host}:{process.pid ?? '?'}
                                    </span>
                                    <span className="ml-auto">{process.seenAt ? timeAgo(process.seenAt) : '—'}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </article>
    );
}

/**
 * One pip per live process, plus hollow pips up to the configured ceiling.
 *
 * The empty slots matter: three filled pips out of six is Horizon having scaled
 * down because there is no work, which is a different thing from a supervisor
 * that only ever had three.
 */
function Pips({ pool }: { pool: QueuePool }) {
    const ceiling = Math.min(Math.max(pool.maxProcesses ?? pool.processCount, pool.processCount), 12);
    const slots = Array.from({ length: Math.max(ceiling, 1) });

    return (
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
            {slots.map((_, index) => {
                const process = pool.processes[index];

                return (
                    <span
                        key={index}
                        className={cn(
                            'block h-3.5 w-2 rounded-[2px]',
                            process === undefined
                                ? 'bg-[var(--color-surface-2)]'
                                : process.job !== null
                                  ? 'bg-[var(--color-warning)]'
                                  : 'bg-[var(--color-accent)]',
                        )}
                    />
                );
            })}
        </span>
    );
}

/**
 * What the busy processes are actually doing.
 *
 * This is the line that makes the page worth opening during an incident: a
 * process that has been on the same modpack install for forty minutes is
 * healthy, and one that has been on a five-second job for forty minutes is not.
 */
function BusyLines({ processes }: { processes: QueueProcess[] }) {
    const busy = processes.filter(process => process.job !== null);

    if (busy.length === 0) return null;

    return (
        <ul className="mt-2 space-y-1">
            {busy.map(process => (
                <li
                    key={`${process.host}-${process.pid}-busy`}
                    className="flex items-baseline gap-2 text-[11px] text-[var(--color-ink-muted)]"
                >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
                    <span className="truncate">{process.jobTitle ?? process.job}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-ink-faint)]">
                        {formatDuration(process.busySeconds)}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function statusLabel(pool: QueuePool, running: boolean, starved: boolean): string {
    if (starved) return m['admin.queues.pool.starved']();
    if (!pool.expected && pool.processCount === 0) return m['admin.queues.pool.off']();
    if (!running) return m['admin.queues.status.stopped']();

    return pool.busyCount > 0
        ? m['admin.queues.pool.busy']({ count: pool.busyCount })
        : m['admin.queues.pool.idle']();
}
