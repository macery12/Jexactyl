import type { ChatEntry } from '@/state/agentChat';

export type { DetailGroup, DetailRow } from './SessionDetail';

/**
 * What this conversation has actually done, counted from the transcript.
 *
 * Derived rather than reported, deliberately. The stream carries no per-session
 * totals today, and a column that quietly showed zeroes because the backend had
 * not been asked would be worse than one that showed nothing — so these are
 * counted from the entries already on screen, which means they are true by
 * construction and degrade to real numbers rather than to placeholders.
 *
 * `reads` counts every settled tool call, `changes` counts only the ones the
 * backend classified as writing something. A call that is still running is in
 * neither: it has not read or changed anything yet.
 */
export function sessionCounters(entries: ChatEntry[]): {
    turns: number;
    reads: number;
    changes: number;
} {
    let turns = 0;
    let reads = 0;
    let changes = 0;

    for (const entry of entries) {
        if (entry.kind === 'user') {
            turns += 1;
            continue;
        }

        if (entry.kind !== 'tool') continue;
        if (entry.status === 'pending' || entry.status === 'running') continue;

        if (entry.risk === 'safe') reads += 1;
        else changes += 1;
    }

    return { turns, reads, changes };
}
