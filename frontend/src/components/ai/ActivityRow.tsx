import { useEffect, useState } from 'react';
import { m } from '@/i18n';
import { Spinner } from '@/components/ui/Spinner';
import type { Activity } from '@/state/agentChat';
import { toolLabel } from './toolMeta';

// What the turn is doing, at the foot of the transcript.
//
// The problem this solves is specific: between sending a turn and the model's
// first token there is a stretch — seconds on a hosted model, longer on a cold
// local one — where the transcript is frozen and nothing on screen distinguishes
// "thinking" from "broken". A stop button is not reassurance.
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

export function ActivityRow({ activity }: { activity: Activity }) {
    const elapsed = useElapsed(activity.startedAt);

    return (
        <div className="flex items-center gap-2.5 px-1 py-0.5 text-xs text-[var(--color-ink-muted)]">
            <Spinner className="h-3.5 w-3.5 shrink-0" />

            <span className="min-w-0 flex-1 truncate">{PHASE_LABEL[activity.phase](activity.tool)}</span>

            {/* Held back for a moment: a counter appearing instantly on every
                fast step is noise, and only a wait long enough to notice is a
                wait worth timing. */}
            {elapsed >= 2 && (
                <span className="shrink-0 font-mono tabular-nums text-[11px] text-[var(--color-ink-faint)]">
                    {formatElapsed(elapsed)}
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
function useElapsed(startedAt: number): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);

        return () => clearInterval(id);
    }, [startedAt]);

    return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
