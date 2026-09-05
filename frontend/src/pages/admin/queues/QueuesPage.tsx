import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { getQueueHealth, type QueueHealth, type QueueWarning } from '@/api/adminQueues';
import { LanesPanel } from './LanesPanel';
import { WorkerPools } from './WorkerPools';
import { JobTypesPanel } from './JobTypesPanel';
import { FailedJobsPanel } from './FailedJobsPanel';

const TABS = ['lanes', 'workers', 'failed', 'jobs'] as const;
type Tab = (typeof TABS)[number];

/**
 * Worker-queue health.
 *
 * One status line and four tabs, rather than four stacked tables. The summary
 * is a sentence in the toolbar because that is all it needs to be: an operator
 * opening this page is asking "is anything wrong", and only then "where". The
 * tab labels carry the counts, so a problem on a tab you are not looking at
 * still announces itself.
 */
export default function QueuesPage() {
    const [params, setParams] = useSearchParams();

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'queues'],
        queryFn: getQueueHealth,
        refetchInterval: 15_000,
    });

    const requested = params.get('tab');
    const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'lanes';

    if (isLoading || !data) {
        return (
            <div className="flex justify-center py-16">
                <Spinner />
            </div>
        );
    }

    const failedCount = data.failed.total ?? 0;
    const problems = data.warnings.filter(warning => warning.severity === 'critical').length;

    return (
        <div className="space-y-4">
            <Toolbar data={data} />

            {data.warnings.length > 0 ? (
                <ul className="space-y-2">
                    {data.warnings.map((warning, index) => (
                        <WarningRow key={`${warning.code}-${index}`} warning={warning} />
                    ))}
                </ul>
            ) : (
                <p className="flex items-center gap-2 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2.5 text-sm text-[var(--color-ink)]">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                    {m['admin.queues.healthy']()}
                </p>
            )}

            <div
                role="tablist"
                aria-label={m['admin.queues.title']()}
                className="inline-flex w-fit gap-1 rounded-lg bg-[var(--color-surface-2)] p-1"
            >
                <TabButton id="lanes" active={tab} onSelect={setParams} label={m['admin.queues.tab.lanes']()} />
                <TabButton
                    id="workers"
                    active={tab}
                    onSelect={setParams}
                    label={m['admin.queues.tab.workers']()}
                    badge={problems > 0 ? String(problems) : undefined}
                    tone="danger"
                />
                <TabButton
                    id="failed"
                    active={tab}
                    onSelect={setParams}
                    label={m['admin.queues.tab.failed']()}
                    badge={failedCount > 0 ? String(failedCount) : undefined}
                    tone="danger"
                />
                <TabButton id="jobs" active={tab} onSelect={setParams} label={m['admin.queues.tab.jobs']()} />
            </div>

            <div role="tabpanel" aria-label={m['admin.queues.title']()}>
                {tab === 'lanes' && <LanesPanel lanes={data.lanes} windowMinutes={data.metricsWindowMinutes} />}
                {tab === 'workers' && <WorkerPools pools={data.pools} running={data.horizon.running} scheduler={data.scheduler} />}
                {tab === 'failed' && <FailedJobsPanel summary={data.failed} />}
                {tab === 'jobs' && <JobTypesPanel jobs={data.jobs} windowMinutes={data.metricsWindowMinutes} />}
            </div>
        </div>
    );
}

/**
 * The whole summary, as one line of type.
 *
 * Four tiles with coloured rails made this read as a dashboard rather than as
 * an instrument; a sentence with three numbers in it says the same thing and
 * lets colour mean something when it does appear.
 */
function Toolbar({ data }: { data: QueueHealth }) {
    const { running, paused } = data.horizon;

    const longestWait = Math.max(0, ...data.lanes.map(lane => lane.waitSeconds ?? 0));
    const overTarget = data.lanes.some(
        lane =>
            lane.waitSeconds !== null &&
            lane.waitThresholdSeconds !== null &&
            lane.waitSeconds > lane.waitThresholdSeconds,
    );
    const failed = data.failed.total ?? 0;
    const scheduler = data.scheduler.severity;

    return (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-border-strong)] pb-3">
            <h1 className="text-base font-semibold text-[var(--color-ink)]">{m['admin.queues.title']()}</h1>

            <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-[var(--color-ink-muted)]">
                <span
                    className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        !running
                            ? 'bg-[var(--color-danger)]'
                            : paused
                              ? 'bg-[var(--color-warning)]'
                              : 'bg-[var(--color-accent)]',
                    )}
                    aria-hidden="true"
                />
                <span className={cn(!running && 'font-semibold text-[var(--color-danger)]')}>
                    {!running
                        ? m['admin.queues.status.stopped']()
                        : paused
                          ? m['admin.queues.status.paused']()
                          : m['admin.queues.status.running']()}
                </span>
                <Sep />
                <span className="text-[var(--color-ink)]">{data.totalDepth}</span>
                {m['admin.queues.bar.queued']()}
                <Sep />
                <span className={cn(overTarget ? 'font-semibold text-[var(--color-warning)]' : 'text-[var(--color-ink)]')}>
                    {longestWait}s
                </span>
                {m['admin.queues.bar.longestWait']()}
                <Sep />
                <span className={cn(failed > 0 ? 'font-semibold text-[var(--color-danger)]' : 'text-[var(--color-ink)]')}>
                    {failed}
                </span>
                {m['admin.queues.bar.failed']()}
                <Sep />
                {/* Cron, in the same line as Horizon, because "is the panel
                    healthy" is one question with two halves that fail
                    independently -- and only one of them has a queue symptom. */}
                <span
                    className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        scheduler === 'ok'
                            ? 'bg-[var(--color-accent)]'
                            : scheduler === 'down'
                              ? 'bg-[var(--color-danger)]'
                              : 'bg-[var(--color-warning)]',
                    )}
                    aria-hidden="true"
                />
                <span
                    className={cn(
                        scheduler === 'down' && 'font-semibold text-[var(--color-danger)]',
                        scheduler === 'stale' && 'font-semibold text-[var(--color-warning)]',
                    )}
                >
                    {m['admin.queues.bar.cron']()}
                </span>
                <span className={cn(scheduler === 'ok' ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)]')}>
                    {data.scheduler.secondsAgo === null
                        ? m['admin.queues.scheduler.never']()
                        : m['admin.queues.scheduler.ago']({ seconds: data.scheduler.secondsAgo })}
                </span>
            </p>

            <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                {m['admin.queues.updated']({ time: timeAgo(data.generatedAt) })}
            </span>
        </header>
    );
}

function Sep() {
    return <span className="px-0.5 text-[var(--color-ink-faint)]">·</span>;
}

function TabButton({
    id,
    active,
    onSelect,
    label,
    badge,
    tone,
}: {
    id: Tab;
    active: Tab;
    onSelect: (next: URLSearchParams) => void;
    label: string;
    badge?: string;
    tone?: 'danger';
}) {
    const selected = active === id;

    return (
        <button
            type="button"
            role="tab"
            aria-selected={selected}
            // The tab lives in the URL so a reload, or a link pasted into a
            // ticket, lands on the thing that was being looked at.
            onClick={() => onSelect(id === 'lanes' ? new URLSearchParams() : new URLSearchParams({ tab: id }))}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                selected
                    ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
        >
            {label}
            {badge && (
                <span
                    className={cn(
                        'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                        tone === 'danger'
                            ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
                            : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                    )}
                >
                    {badge}
                </span>
            )}
        </button>
    );
}

function WarningRow({ warning }: { warning: QueueWarning }) {
    const critical = warning.severity === 'critical';
    const Icon = critical ? XCircle : AlertTriangle;

    return (
        <li
            className={cn(
                'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
                critical
                    ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10'
                    : 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10',
            )}
        >
            <Icon
                className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    critical ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]',
                )}
            />
            <span className="text-[var(--color-ink)]">{warning.message}</span>
        </li>
    );
}
