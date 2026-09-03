import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { QueueLane } from '@/api/adminQueues';
import { Sparkline } from './Sparkline';
import { formatMs } from './format';

/**
 * Lanes, with the busy ones promoted.
 *
 * A lane carrying work or in trouble gets a card with its own chart; a lane
 * that is clear collapses to a single line. The page therefore gets quieter as
 * the system gets healthier -- which is the opposite of the table this
 * replaced, where seven rows of zeroes looked exactly like seven busy lanes.
 */
export function LanesPanel({ lanes, windowMinutes }: { lanes: QueueLane[]; windowMinutes: number | null }) {
    // "Notable" is work queued, a missing worker, or a wait past the lane's own
    // target. Anything else is doing its job and does not need a card.
    const promoted = lanes.filter(lane => isNotable(lane));
    const quiet = lanes.filter(lane => !isNotable(lane));

    return (
        <div className="space-y-4">
            {promoted.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {promoted.map(lane => (
                        <LaneCard key={lane.lane} lane={lane} />
                    ))}
                </div>
            )}

            {/* Everything else, as an instrument rather than as a row of empty
                pills. A healthy install has nothing to promote, and a page that
                is then almost blank reads as broken rather than as calm -- the
                figures are the content when there is no problem to show. */}
            {quiet.length > 0 && <QuietLanes lanes={quiet} windowMinutes={windowMinutes} promoted={promoted.length > 0} />}
        </div>
    );
}

function isNotable(lane: QueueLane): boolean {
    if (!lane.expected) return false;

    return (lane.depth ?? 0) > 0 || !lane.consumed || isOverTarget(lane);
}

function isOverTarget(lane: QueueLane): boolean {
    return (
        lane.waitSeconds !== null &&
        lane.waitThresholdSeconds !== null &&
        lane.waitSeconds > lane.waitThresholdSeconds
    );
}

/**
 * Severity is read once, here, so the stripe, the border, the figure and the
 * chart all agree. A lane with no worker is the loudest state on the page:
 * depth without a consumer is work that will never run.
 */
function toneFor(lane: QueueLane): 'danger' | 'warning' | 'accent' {
    if (lane.expected && !lane.consumed) return 'danger';
    if (isOverTarget(lane)) return 'warning';

    return 'accent';
}

const TONE_TEXT = {
    danger: 'text-[var(--color-danger)]',
    warning: 'text-[var(--color-warning)]',
    accent: 'text-[var(--color-accent)]',
} as const;

const TONE_BG = {
    danger: 'bg-[var(--color-danger)]',
    warning: 'bg-[var(--color-warning)]',
    accent: 'bg-[var(--color-accent)]',
} as const;

const TONE_BORDER = {
    danger: 'border-[color-mix(in_oklab,var(--color-danger)_45%,var(--color-border-strong))]',
    warning: 'border-[color-mix(in_oklab,var(--color-warning)_40%,var(--color-border-strong))]',
    accent: 'border-[var(--color-border-strong)]',
} as const;

/**
 * How full the bar reads, 0-100.
 *
 * Estimated wait against the lane's own target is the honest measure -- two
 * queued modpack installs matter more than twenty queued emails, and only the
 * lane's threshold knows that. Lanes with no estimate yet fall back to depth on
 * a fixed ten-job scale, which is a gauge rather than a measurement and is why
 * the number beside it is the thing actually being reported.
 */
function fillFor(lane: QueueLane): number {
    const depth = lane.depth ?? 0;

    if (depth === 0) return 0;

    const ratio =
        lane.waitSeconds !== null && lane.waitThresholdSeconds
            ? lane.waitSeconds / lane.waitThresholdSeconds
            : depth / 10;

    return Math.min(100, Math.max(4, Math.round(ratio * 100)));
}

function LaneCard({ lane }: { lane: QueueLane }) {
    const tone = toneFor(lane);
    const depth = lane.depth ?? 0;
    const fill = fillFor(lane);

    return (
        <article
            className={cn(
                'relative overflow-hidden rounded-lg border bg-[var(--color-surface)] p-3.5',
                TONE_BORDER[tone],
            )}
        >
            <span className={cn('absolute inset-y-0 left-0 w-0.5', TONE_BG[tone])} aria-hidden="true" />

            <header className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{lane.lane}</h3>
                <p className="truncate text-[11px] text-[var(--color-ink-faint)]">{lane.title}</p>
                <span className={cn('ml-auto shrink-0 text-[11px] font-medium', workerTone(lane))}>
                    {workerLabel(lane)}
                </span>
            </header>

            <div className="mt-2 flex items-end gap-2">
                <span className={cn('font-mono text-2xl font-semibold leading-none tabular-nums', depth > 0 ? TONE_TEXT[tone] : 'text-[var(--color-ink-faint)]')}>
                    {lane.depth ?? '—'}
                </span>
                <span className="pb-0.5 font-mono text-[11px] text-[var(--color-ink-faint)]">
                    {m['admin.queues.lane.queued']()}
                </span>
                <span className="ml-auto pb-0.5 font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
                    {lane.waitSeconds === null ? '—' : `${lane.waitSeconds}s`} · {formatMs(lane.avgRuntimeMs)}
                </span>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <span className={cn('block h-full rounded-full', TONE_BG[tone])} style={{ width: `${fill}%` }} />
            </div>

            <Sparkline
                area
                className={cn('mt-2 block w-full', TONE_TEXT[tone])}
                width={200}
                height={28}
                points={lane.series.map(point => point.throughput)}
            />

            <p className={cn('mt-1.5 font-mono text-[10px]', isOverTarget(lane) ? TONE_TEXT[tone] : 'text-[var(--color-ink-faint)]')}>
                {isOverTarget(lane) && lane.waitThresholdSeconds !== null
                    ? m['admin.queues.lane.overTarget']({ target: lane.waitThresholdSeconds })
                    : m['admin.queues.lane.processed']({ count: lane.processed ?? 0 })}
            </p>
        </article>
    );
}

/**
 * The lanes that are behaving, in one dense readout.
 *
 * Deliberately a table: these rows exist to be compared down a column -- which
 * lane is slowest, which has never run anything -- and that is the one thing a
 * grid of cards is bad at. It also gives the resting state something to be.
 */
function QuietLanes({
    lanes,
    windowMinutes,
    promoted,
}: {
    lanes: QueueLane[];
    windowMinutes: number | null;
    promoted: boolean;
}) {
    return (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60">
            <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    {promoted ? m['admin.queues.lanes.rest']() : m['admin.queues.tab.lanes']()}
                </h2>
                {windowMinutes !== null && (
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-ink-faint)]">
                        {m['admin.queues.metricsWindow']({ minutes: windowMinutes })}
                    </span>
                )}
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                    <thead className="text-left text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                        <tr className="border-b border-[var(--color-border)]">
                            <th className="px-4 py-2 font-medium">{m['admin.queues.col.lane']()}</th>
                            <th className="px-4 py-2 font-medium">{m['admin.queues.col.consumer']()}</th>
                            <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.depth']()}</th>
                            <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.processed']()}</th>
                            <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.runtime']()}</th>
                            <th className="px-4 py-2 text-right font-medium">{m['admin.queues.col.trend']()}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lanes.map(lane => (
                            <QuietLaneRow key={lane.lane} lane={lane} />
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function QuietLaneRow({ lane }: { lane: QueueLane }) {
    const off = !lane.expected;
    // A staffed lane that has never seen work is not broken, but a row of
    // dashes reads exactly like one. Say which it is.
    const untouched = !off && (lane.processed ?? 0) === 0;

    return (
        <tr className={cn('border-b border-[var(--color-border)] last:border-0', off && 'opacity-55')}>
            <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            off ? 'bg-[var(--color-ink-faint)]' : 'bg-[var(--color-accent)]',
                        )}
                        aria-hidden="true"
                    />
                    <span className="font-medium text-[var(--color-ink)]">{lane.lane}</span>
                    <span className="truncate text-xs text-[var(--color-ink-faint)]">{lane.title}</span>
                    {lane.long && (
                        <span className="rounded border border-[var(--color-border)] px-1 font-mono text-[9px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                            {m['admin.queues.lane.long']()}
                        </span>
                    )}
                </div>
            </td>
            <td className="px-4 py-2 text-xs">
                <span className={workerTone(lane)}>{workerLabel(lane)}</span>
            </td>
            <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-[var(--color-ink-faint)]">
                {off ? m['admin.queues.lane.moduleOff']() : (lane.depth ?? '—')}
            </td>
            <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-[var(--color-ink-muted)]">
                {untouched ? (
                    <span className="text-[var(--color-ink-faint)]">{m['admin.queues.lane.never']()}</span>
                ) : (
                    (lane.processed ?? '—')
                )}
            </td>
            <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-[var(--color-ink-muted)]">
                {formatMs(lane.avgRuntimeMs)}
            </td>
            <td className="px-4 py-2 text-right text-[var(--color-accent)]">
                <Sparkline className="inline-block align-middle" points={lane.series.map(point => point.throughput)} />
            </td>
        </tr>
    );
}

function workerLabel(lane: QueueLane): string {
    if (!lane.expected) return m['admin.queues.consumer.na']();
    if (!lane.consumed) return m['admin.queues.consumer.none']();

    return lane.processes === null
        ? m['admin.queues.consumer.yes']()
        : m['admin.queues.lane.workers']({ count: lane.processes });
}

function workerTone(lane: QueueLane): string {
    if (!lane.expected) return 'text-[var(--color-ink-faint)]';

    return lane.consumed ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-danger)]';
}
