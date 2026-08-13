import { Hourglass } from 'lucide-react';
import { m } from '@/i18n';
import type { QueuePosition } from '@/state/agentChat';

// Shown while a turn waits for an inference slot.
//
// A self-hosted GPU serves a fixed number of requests at once; past that,
// queueing beats thrashing. Saying so — with a position and an estimate — is
// the difference between "the panel is slow" and "four people are ahead of you".
export function QueueBanner({ queue }: { queue: QueuePosition }) {
    return (
        <div className="flex items-center gap-2.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs">
            <Hourglass className="h-3.5 w-3.5 shrink-0 animate-pulse text-[var(--brand)]" />
            <span className="text-[var(--color-ink)]">
                {queue.ahead === 0
                    ? m['server.ai.queue.next']()
                    : m['server.ai.queue.waiting']({ ahead: queue.ahead })}
            </span>
            {queue.etaSeconds > 0 && (
                <span className="text-[var(--color-ink-faint)]">
                    {m['server.ai.queue.eta']({ seconds: queue.etaSeconds })}
                </span>
            )}
        </div>
    );
}
