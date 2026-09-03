import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { timeAgo } from '@/lib/format';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    deleteFailedJob,
    deleteFailedJobs,
    getFailedJob,
    getFailedJobs,
    previewSweep,
    retryFailedJob,
    retryFailedJobs,
    sweepFailedJobs,
    type FailedJob,
    type QueueHealth,
    type SweepScope,
} from '@/api/adminQueues';
import { FailedJobModal } from './FailedJobModal';

const FAILED_KEY = ['admin', 'queues', 'failed'];

// Radix's Select treats an empty string as "no value", which would leave the
// trigger blank instead of showing the all-queues label.
const ALL_QUEUES = '__all__';

/** Ages offered for a sweep. Seven days is the retention window itself. */
const SWEEP_AGES = [1, 7, 30];

/** What a confirmation is currently about, so one dialog serves every action. */
type Pending =
    | { kind: 'retry'; job: FailedJob }
    | { kind: 'delete'; job: FailedJob }
    | { kind: 'retrySelection'; uuids: string[] }
    | { kind: 'deleteSelection'; uuids: string[] }
    | { kind: 'sweep'; scope: SweepScope; label: string; count: number; matched: number };

/**
 * The failures behind the count, with a way to act on them.
 *
 * A total on its own is a dead end: it tells an operator something broke but
 * not what, and leaves the only recovery path on the command line. Reads from
 * the `failed_jobs` table rather than Horizon, so the list survives a Redis
 * flush and matches what `queue:retry` would act on.
 *
 * Both recoveries are here now. Retry re-runs the work; delete discards it, and
 * is the one that cannot be undone -- the row is the only copy of the payload.
 * Every sweep is scoped by lane or by age, because an unscoped "clear all" is
 * one mis-click away from destroying every payload in the retention window.
 */
export function FailedJobsPanel({ summary }: { summary: QueueHealth['failed'] }) {
    const held = useAdminHeld();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [queue, setQueue] = useState<string>('');
    const [page, setPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [inspecting, setInspecting] = useState<FailedJob | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);

    const canRetry = can(held, 'queues.retry');
    const canDelete = can(held, 'queues.delete');
    const configured = summary.total !== null;

    const { data, isLoading } = useQuery({
        queryKey: [...FAILED_KEY, queue, page],
        queryFn: () => getFailedJobs({ page, queue: queue || null }),
        // Nothing to list when there is no database failed-job store, and
        // nothing to list when nothing has failed.
        enabled: configured && (summary.total ?? 0) > 0,
    });

    // The trace is fetched only when a row is opened -- shipping every stack
    // trace with the list would make the common case expensive for the rare one.
    const { data: detail } = useQuery({
        queryKey: [...FAILED_KEY, 'detail', inspecting?.uuid],
        queryFn: () => getFailedJob(inspecting!.uuid),
        enabled: inspecting !== null,
    });

    const rows = useMemo(() => data?.items ?? [], [data]);

    // A selection that outlived the rows it referred to would act on jobs the
    // admin can no longer see -- a page change, a filter, or a refetch that
    // dropped a row. Filtered at read time rather than synced back into state,
    // so there is no window in which the two disagree.
    const selected = useMemo(
        () => selectedIds.filter(uuid => rows.some(row => row.uuid === uuid)),
        [selectedIds, rows],
    );

    const settle = (message: string) => {
        // Both the list and the health snapshot carry a now-stale count.
        qc.invalidateQueries({ queryKey: FAILED_KEY });
        qc.invalidateQueries({ queryKey: ['admin', 'queues'] });
        push({ type: 'success', message });
        setPending(null);
        setInspecting(null);
        setSelectedIds([]);
    };

    const fail = (err: unknown) =>
        push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });

    const act = useMutation({
        mutationFn: async (action: Pending) => {
            switch (action.kind) {
                case 'retry':
                    return retryFailedJob(action.job.uuid).then(() => m['admin.queues.failed.retried']());
                case 'delete':
                    return deleteFailedJob(action.job.uuid).then(() => m['admin.queues.failed.deleted']());
                case 'retrySelection':
                    return retryFailedJobs(action.uuids).then(result =>
                        m['admin.queues.failed.retriedCount']({ count: result.retried }),
                    );
                case 'deleteSelection':
                    return deleteFailedJobs(action.uuids).then(result =>
                        m['admin.queues.failed.deletedCount']({ count: result.deleted }),
                    );
                case 'sweep':
                    return sweepFailedJobs(action.scope).then(result =>
                        // One sweep is capped, so a wide scope leaves a
                        // remainder. Saying so is the difference between "the
                        // lane is clear" and "go again".
                        result.remaining > 0
                            ? m['admin.queues.failed.sweptWithRemainder']({
                                  count: result.deleted,
                                  remaining: result.remaining,
                              })
                            : m['admin.queues.failed.deletedCount']({ count: result.deleted }),
                    );
            }
        },
        onSuccess: message => settle(message ?? ''),
        onError: fail,
    });

    // The exact number is resolved before the dialog opens, so the confirmation
    // can name what it is about to destroy rather than describing a filter.
    const openSweep = async (scope: SweepScope, label: string) => {
        try {
            const { count, cap } = await previewSweep(scope);

            if (count === 0) {
                push({ type: 'info', message: m['admin.queues.failed.sweepEmpty']() });

                return;
            }

            // The dialog names what this pass will actually take, not what the
            // filter matches -- promising 4,000 and destroying 500 would make
            // the confirmation a lie.
            setPending({ kind: 'sweep', scope, label, count: Math.min(count, cap), matched: count });
        } catch (err) {
            fail(err);
        }
    };

    const pageCount = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
    const allSelected = rows.length > 0 && selected.length === rows.length;

    return (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
                <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.queues.failed.title']()}</h2>

                {configured && (
                    <>
                        <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">{summary.total}</span>
                        <span className="text-xs text-[var(--color-ink-muted)]">
                            {m['admin.queues.failed.lastDay']({ count: summary.lastDay ?? 0 })}
                        </span>
                        {summary.oldestFailedAt && (
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {m['admin.queues.failed.oldest']({ time: timeAgo(summary.oldestFailedAt) })}
                            </span>
                        )}
                    </>
                )}

                {(data?.queues.length ?? 0) > 1 && (
                    <div className="ml-auto w-44">
                        <Select
                            value={queue || ALL_QUEUES}
                            onChange={value => {
                                setQueue(value === ALL_QUEUES ? '' : value);
                                setPage(1);
                            }}
                            options={[
                                { value: ALL_QUEUES, label: m['admin.queues.failed.allQueues']() },
                                ...(data?.queues ?? []).map(name => ({ value: name, label: name })),
                            ]}
                        />
                    </div>
                )}
            </div>

            {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-2.5">
                    <span className="text-sm font-semibold text-[var(--color-ink)]">
                        {m['admin.queues.failed.selected']({ count: selected.length })}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        {canRetry && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setPending({ kind: 'retrySelection', uuids: selected })}
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                {m['admin.queues.failed.retryCount']({ count: selected.length })}
                            </Button>
                        )}
                        {canDelete && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPending({ kind: 'deleteSelection', uuids: selected })}
                                className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                {m['admin.queues.failed.deleteCount']({ count: selected.length })}
                            </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                            {m['admin.queues.failed.clearSelection']()}
                        </Button>
                    </div>
                </div>
            )}

            {!configured ? (
                <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)]">{m['admin.queues.failed.unavailable']()}</p>
            ) : (summary.total ?? 0) === 0 ? (
                <div className="px-4 py-6">
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.queues.failed.none']()}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{m['admin.queues.failed.retention']()}</p>
                </div>
            ) : isLoading ? (
                <div className="flex justify-center py-8">
                    <Spinner />
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[52rem] text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                                <tr className="border-b border-[var(--color-border)]">
                                    {canDelete && (
                                        <th className="w-10 px-4 py-2">
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={() => setSelectedIds(allSelected ? [] : rows.map(row => row.uuid))}
                                                aria-label={m['admin.queues.failed.selectAll']()}
                                                className="h-3.5 w-3.5 accent-[var(--brand)]"
                                            />
                                        </th>
                                    )}
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.col.job']()}</th>
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.col.lane']()}</th>
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.failed.col.error']()}</th>
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.failed.col.when']()}</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(job => (
                                    <tr key={job.uuid} className="border-b border-[var(--color-border)] last:border-0">
                                        {canDelete && (
                                            <td className="px-4 py-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.includes(job.uuid)}
                                                    onChange={() =>
                                                        setSelectedIds(current =>
                                                            current.includes(job.uuid)
                                                                ? current.filter(uuid => uuid !== job.uuid)
                                                                : [...current, job.uuid],
                                                        )
                                                    }
                                                    aria-label={job.title}
                                                    className="h-3.5 w-3.5 accent-[var(--brand)]"
                                                />
                                            </td>
                                        )}
                                        <td className="px-4 py-2.5">
                                            <button
                                                type="button"
                                                onClick={() => setInspecting(job)}
                                                className="text-left font-medium text-[var(--color-ink)] underline-offset-2 hover:underline"
                                            >
                                                {job.title}
                                            </button>
                                            <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                                                {m['admin.queues.failed.attemptsOf']({ count: job.attempts ?? 0 })}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-ink-muted)]">
                                            {job.lane ?? job.queue}
                                        </td>
                                        <td className="max-w-[26rem] px-4 py-2.5 text-xs text-[var(--color-ink-muted)]">
                                            {job.exceptionClass && (
                                                <span className="font-mono text-[var(--color-danger)]">
                                                    {job.exceptionClass.split('\\').pop()}:{' '}
                                                </span>
                                            )}
                                            <span className="line-clamp-2 break-words align-top">{job.exceptionMessage}</span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--color-ink-faint)]">
                                            {job.failedAt ? timeAgo(job.failedAt) : '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center justify-end gap-1">
                                                {canRetry && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setPending({ kind: 'retry', job })}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                        {m['admin.queues.failed.retry']()}
                                                    </Button>
                                                )}
                                                {canDelete && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        aria-label={m['admin.queues.failed.delete']()}
                                                        onClick={() => setPending({ kind: 'delete', job })}
                                                        className="text-[var(--color-ink-faint)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-2.5">
                        <span className="text-xs text-[var(--color-ink-faint)]">
                            {m['admin.queues.failed.pageOf']({ current: page, total: pageCount })}
                        </span>

                        {pageCount > 1 && (
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                    {m['admin.queues.failed.prev']()}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page >= pageCount}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    {m['admin.queues.failed.next']()}
                                </Button>
                            </div>
                        )}

                        {/* Sweeps are always scoped -- by lane or by age. There is
                            deliberately no control here that clears everything. */}
                        {canDelete && (
                            <div className="ml-auto flex flex-wrap items-center gap-2">
                                {queue !== '' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openSweep({ queue }, m['admin.queues.failed.sweepLane']({ lane: queue }))}
                                        className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                                    >
                                        {m['admin.queues.failed.sweepLane']({ lane: queue })}
                                    </Button>
                                )}
                                {SWEEP_AGES.map(days => (
                                    <Button
                                        key={days}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            openSweep(
                                                { olderThanDays: days, queue: queue || null },
                                                m['admin.queues.failed.sweepAge']({ days }),
                                            )
                                        }
                                        className="text-[var(--color-ink-faint)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                                    >
                                        {m['admin.queues.failed.sweepAge']({ days })}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            <FailedJobModal
                job={inspecting}
                detail={detail}
                onClose={() => setInspecting(null)}
                onRetry={job => setPending({ kind: 'retry', job })}
                onDelete={job => setPending({ kind: 'delete', job })}
                canRetry={canRetry}
                canDelete={canDelete}
            />

            <ConfirmDialog
                open={pending !== null}
                onClose={() => setPending(null)}
                title={confirmTitle(pending)}
                body={confirmBody(pending)}
                confirmLabel={confirmLabel(pending)}
                cancelLabel={m['common.actions.cancel']()}
                danger={pending !== null && pending.kind !== 'retry' && pending.kind !== 'retrySelection'}
                busy={act.isPending}
                onConfirm={() => pending && act.mutate(pending)}
            />
        </section>
    );
}

function confirmTitle(pending: Pending | null): string {
    switch (pending?.kind) {
        case 'retry':
        case 'retrySelection':
            return m['admin.queues.failed.retryTitle']();
        case 'delete':
        case 'deleteSelection':
        case 'sweep':
            return m['admin.queues.failed.deleteTitle']();
        default:
            return '';
    }
}

/**
 * Every destructive confirmation names the exact number of rows and says that
 * the payload goes with them. "Are you sure?" is not a warning.
 */
function confirmBody(pending: Pending | null): string {
    switch (pending?.kind) {
        case 'retry':
            return m['admin.queues.failed.retryBody']({ job: pending.job.title });
        case 'retrySelection':
            return m['admin.queues.failed.retryBodyCount']({ count: pending.uuids.length });
        case 'delete':
            return m['admin.queues.failed.deleteBody']({ job: pending.job.title });
        case 'deleteSelection':
            return m['admin.queues.failed.deleteBodyCount']({ count: pending.uuids.length });
        case 'sweep':
            // A scope wider than one pass says so up front. An operator who
            // presses this expecting the lane to empty and finds 500 of 4,000
            // gone has been misled by the dialog, not by the cap.
            return pending.matched > pending.count
                ? m['admin.queues.failed.sweepBodyCapped']({
                      count: pending.count,
                      matched: pending.matched,
                      scope: pending.label,
                  })
                : m['admin.queues.failed.sweepBody']({ count: pending.count, scope: pending.label });
        default:
            return '';
    }
}

function confirmLabel(pending: Pending | null): string {
    switch (pending?.kind) {
        case 'retry':
            return m['admin.queues.failed.retry']();
        case 'retrySelection':
            return m['admin.queues.failed.retryCount']({ count: pending.uuids.length });
        case 'delete':
            return m['admin.queues.failed.delete']();
        case 'deleteSelection':
            return m['admin.queues.failed.deleteCount']({ count: pending.uuids.length });
        case 'sweep':
            return m['admin.queues.failed.deleteCount']({ count: pending.count });
        default:
            return '';
    }
}
