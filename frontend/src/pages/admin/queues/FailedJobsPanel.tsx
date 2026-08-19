import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { can } from '@/lib/can';
import { timeAgo } from '@/lib/format';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getFailedJob, getFailedJobs, retryFailedJob, type FailedJob, type QueueHealth } from '@/api/adminQueues';

const FAILED_KEY = ['admin', 'queues', 'failed'];

// Radix's Select treats an empty string as "no value", which would leave the
// trigger blank instead of showing the all-queues label.
const ALL_QUEUES = '__all__';

/**
 * The failures behind the count, with a way to act on them.
 *
 * A total on its own is a dead end: it tells an operator something broke but
 * not what, and leaves the only recovery path on the command line. Reads from
 * the `failed_jobs` table rather than Horizon, so the list survives a Redis
 * flush and matches what `queue:retry` would act on.
 */
export function FailedJobsPanel({ summary }: { summary: QueueHealth['failed'] }) {
    const held = useAdminHeld();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [queue, setQueue] = useState<string>('');
    const [page, setPage] = useState(1);
    const [inspecting, setInspecting] = useState<FailedJob | null>(null);
    const [retrying, setRetrying] = useState<FailedJob | null>(null);

    const canRetry = can(held, 'queues.retry');
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

    const retry = useMutation({
        mutationFn: (uuid: string) => retryFailedJob(uuid),
        onSuccess: () => {
            // Both the list and the health snapshot carry a now-stale count.
            qc.invalidateQueries({ queryKey: FAILED_KEY });
            qc.invalidateQueries({ queryKey: ['admin', 'queues'] });
            push({ type: 'success', message: m['admin.queues.failed.retried']() });
            setRetrying(null);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const pageCount = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

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

            {!configured ? (
                <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)]">{m['admin.queues.failed.unavailable']()}</p>
            ) : (summary.total ?? 0) === 0 ? (
                <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)]">{m['admin.queues.failed.none']()}</p>
            ) : isLoading ? (
                <div className="flex justify-center py-8">
                    <Spinner />
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[46rem] text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                                <tr className="border-b border-[var(--color-border)]">
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.col.job']()}</th>
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.col.lane']()}</th>
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.failed.col.error']()}</th>
                                    <th className="px-4 py-2 font-medium">{m['admin.queues.failed.col.when']()}</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {data?.items.map(job => (
                                    <tr key={job.uuid} className="border-b border-[var(--color-border)] last:border-0">
                                        <td className="px-4 py-2.5">
                                            <button
                                                type="button"
                                                onClick={() => setInspecting(job)}
                                                className="font-mono text-xs text-[var(--color-ink)] underline-offset-2 hover:underline"
                                            >
                                                {job.job}
                                            </button>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-[var(--color-ink-muted)]">{job.lane ?? job.queue}</td>
                                        <td className="max-w-[22rem] truncate px-4 py-2.5 text-xs text-[var(--color-ink-muted)]">
                                            {job.exceptionClass && (
                                                <span className="font-mono text-[var(--color-danger)]">{job.exceptionClass.split('\\').pop()}: </span>
                                            )}
                                            {job.exceptionMessage}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--color-ink-faint)]">
                                            {job.failedAt ? timeAgo(job.failedAt) : '—'}
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            {canRetry && (
                                                <Button variant="ghost" size="sm" onClick={() => setRetrying(job)}>
                                                    <RotateCcw className="h-3.5 w-3.5" />
                                                    {m['admin.queues.failed.retry']()}
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {pageCount > 1 && (
                        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2.5">
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {m['admin.queues.failed.pageOf']({ current: page, total: pageCount })}
                            </span>
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                    {m['admin.queues.failed.prev']()}
                                </Button>
                                <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>
                                    {m['admin.queues.failed.next']()}
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}

            <Modal
                open={inspecting !== null}
                onClose={() => setInspecting(null)}
                title={inspecting?.job ?? ''}
                size="lg"
                dismissible
            >
                <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    <Field label={m['admin.queues.col.lane']()} value={inspecting?.lane ?? inspecting?.queue ?? '—'} />
                    <Field label={m['admin.queues.failed.col.connection']()} value={inspecting?.connection ?? '—'} />
                    <Field label={m['admin.queues.failed.col.attempts']()} value={String(inspecting?.attempts ?? '—')} />
                </dl>
                <pre
                    className={cn(
                        'max-h-[24rem] overflow-auto rounded-md border border-[var(--color-border)]',
                        'bg-[var(--color-surface-raised)] p-3 font-mono text-xs text-[var(--color-ink-muted)]',
                    )}
                >
                    {detail?.exception ?? m['common.states.loading']()}
                </pre>
            </Modal>

            <ConfirmDialog
                open={retrying !== null}
                onClose={() => setRetrying(null)}
                title={m['admin.queues.failed.retryTitle']()}
                body={m['admin.queues.failed.retryBody']({ job: retrying?.job ?? '' })}
                confirmLabel={m['admin.queues.failed.retry']()}
                cancelLabel={m['common.actions.cancel']()}
                danger={false}
                busy={retry.isPending}
                onConfirm={() => retrying && retry.mutate(retrying.uuid)}
            />
        </section>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</dt>
            <dd className="font-mono text-xs text-[var(--color-ink)]">{value}</dd>
        </div>
    );
}
