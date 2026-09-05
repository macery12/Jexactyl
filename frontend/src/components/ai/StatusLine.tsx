import { useEffect, useState } from 'react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { Activity, QueuePosition } from '@/state/agentChat';
import { toolLabel } from './toolMeta';

// What the turn is doing, on one line at the very bottom.
//
// This replaces the row that used to sit at the foot of the transcript and the
// counter that used to sit above the composer. Both said something true; neither
// stayed in one place, because a transcript row scrolls and a composer header
// truncates. A fixed strip does not move, so "is it working?" is answered by
// looking at the same six pixels every time rather than by hunting.
//
// It counts up rather than showing a spinner alone because an unmeasured wait
// feels roughly twice as long as a measured one, and because a number that keeps
// moving is proof the stream is still alive.

const PHASE_LABEL: Record<Activity['phase'], (tool?: string) => string> = {
    waiting: () => m['server.ai.activity.waiting'](),
    reasoning: () => m['server.ai.activity.reasoning'](),
    writing: () => m['server.ai.activity.writing'](),
    calling: tool => m['server.ai.activity.calling']({ tool: tool ? toolLabel(tool) : '' }),
    running: tool => m['server.ai.activity.running']({ tool: tool ? toolLabel(tool) : '' }),
};

export function StatusLine({
    loading,
    queue,
    activity,
    step,
    slowHint,
    pending,
    trailing,
}: {
    loading: boolean;
    queue: QueuePosition | null;
    activity: Activity | null;
    step: { step: number; maxSteps: number } | null;
    slowHint: boolean;
    /** Approvals still waiting on a decision. Outranks the phase: the turn is stopped. */
    pending: number;
    /** Route-specific tail — a disclaimer, a lane, a link. */
    trailing?: string;
}) {
    const elapsed = useElapsed(activity?.startedAt);

    // Ordered by what the reader most needs to know. A queue place outranks a
    // phase because a turn that has not started is not working yet; a pending
    // approval outranks both because the turn has stopped and is waiting on a
    // person, which no spinner should be allowed to imply otherwise.
    const state = pending > 0
        ? { tone: 'text-[var(--color-warning)]', dot: 'bg-[var(--color-warning)]', label: m['server.ai.status.awaitingYou']() }
        : queue
          ? { tone: 'text-[var(--color-ink-muted)]', dot: 'bg-[var(--color-ink-faint)]', label: m['server.ai.status.queued']() }
          : loading
            ? { tone: 'text-[var(--brand-bright)]', dot: 'bg-[var(--brand-bright)]', label: m['server.ai.status.running']() }
            : { tone: 'text-[var(--color-ink-faint)]', dot: 'bg-[var(--color-border-strong)]', label: m['server.ai.status.idle']() };

    const detail = queue
        ? m['server.ai.queue.waiting']({ ahead: queue.ahead })
        : loading && activity
          ? PHASE_LABEL[activity.phase](activity.tool)
          : slowHint
            ? m['server.ai.slowHint']()
            : '';

    return (
        <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 font-mono text-[10.5px] text-[var(--color-ink-faint)]">
            <span className={cn('flex shrink-0 items-center gap-1.5', state.tone)}>
                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', state.dot)} />
                {state.label}
            </span>

            {detail !== '' && (
                <span className="min-w-0 truncate text-[var(--color-ink-muted)]">
                    {detail}
                    {/* Held back for a moment: a counter appearing instantly on
                        every fast step is noise, and only a wait long enough to
                        notice is a wait worth timing. */}
                    {loading && elapsed >= 2 && (
                        <span className="ml-1.5 tabular-nums text-[var(--color-ink-faint)]">
                            {formatElapsed(elapsed)}
                        </span>
                    )}
                </span>
            )}

            {step && (
                <span className="shrink-0 tabular-nums">
                    {m['server.ai.stepOf']({ step: step.step, total: step.maxSteps })}
                </span>
            )}

            {/* Titled, because it truncates: the full text is stated in the
                empty state, and this is the reminder rather than the notice. */}
            {trailing && (
                <span title={trailing} className="ml-auto hidden min-w-0 truncate lg:block">
                    {trailing}
                </span>
            )}
        </div>
    );
}

/**
 * Whole seconds since `startedAt`, ticking while mounted.
 *
 * The interval is re-armed when the phase changes so the count restarts in step
 * with it. Nothing is set synchronously on that restart: a tick left over from
 * the previous phase is older than the new start, so it floors to zero and the
 * next tick corrects it — and the row hides the counter below two seconds
 * anyway, which is longer than the gap can last.
 */
function useElapsed(startedAt: number | undefined): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (startedAt === undefined) return;

        const id = setInterval(() => setNow(Date.now()), 1000);

        return () => clearInterval(id);
    }, [startedAt]);

    if (startedAt === undefined) return 0;

    return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
