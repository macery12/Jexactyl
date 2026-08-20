<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\AiTurnEvent;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * The durable tail of a running turn.
 *
 * A turn that outlives the request that started it has no reader to write to,
 * so it writes here instead and the reader catches up from a cursor. That
 * inverts the old contract in the one way that matters: the stream is no longer
 * the turn's output, it is a *view* of the turn's output, and losing a view
 * costs nothing.
 *
 * Two rules govern what gets written.
 *
 * **Sequence is allocated by the writer, not the database.** One turn has
 * exactly one writer — the job that runs it — so an in-process counter seeded
 * from what is already stored is correct and costs no round trip per frame. The
 * unique index is the safety net rather than the mechanism: if a second worker
 * ever ran the same turn, the collision surfaces immediately instead of
 * producing an interleaved log that reads as plausible.
 *
 * **A replayed frame may not carry more than a reloaded transcript would.** The
 * shaped tool payload the model receives is deliberately live-only — it is
 * capped at kilobytes, it is never replayed from storage today, and persisting
 * it here would quietly create a second, larger copy of exactly the data the
 * redaction and shaping rules exist to bound. `strip()` enforces that, so
 * reattaching shows the same tool row a reload does.
 */
class AgentEventLog
{
    /**
     * How many frames one replay request may return. A turn that emitted more
     * than this is drained across several rounds rather than in one query, so a
     * reattaching client cannot make the relay build an unbounded array.
     */
    public const REPLAY_LIMIT = 500;

    /** Redis channel prefix for reader wake-ups. */
    private const CHANNEL = 'ai:turn:';

    /** @var array<string, int> turn id => last sequence this process wrote */
    private array $sequences = [];

    /**
     * Append a frame and wake anyone tailing the turn.
     *
     * Never throws. A turn whose event log is unavailable has to keep running —
     * the transcript is still being written, and killing a turn that is
     * otherwise healthy because its *view* broke would be the wrong trade.
     */
    public function append(string $turnId, AgentEvent $event): void
    {
        try {
            $seq = $this->nextSequence($turnId);

            AiTurnEvent::create([
                'turn_id' => $turnId,
                'seq' => $seq,
                'type' => $event->type,
                'payload' => $this->strip($event),
            ]);

            $this->publish($turnId, $seq);
        } catch (\Throwable $e) {
            // Drop the cached sequence so the next append re-reads the stored
            // maximum. Holding a counter that may have skipped a row would make
            // every later frame in this turn unreplayable.
            unset($this->sequences[$turnId]);

            Log::warning('Failed to append AI turn event: ' . $e->getMessage(), ['turn' => $turnId]);
        }
    }

    /**
     * Frames after a cursor, oldest first.
     *
     * @return list<array{seq: int, event: array<string, mixed>}>
     */
    public function replay(string $turnId, int $afterSeq = 0, int $limit = self::REPLAY_LIMIT): array
    {
        $rows = AiTurnEvent::query()
            ->where('turn_id', $turnId)
            ->where('seq', '>', max(0, $afterSeq))
            ->orderBy('seq')
            ->limit(max(1, $limit))
            ->get(['seq', 'type', 'payload']);

        return $rows->map(fn (AiTurnEvent $row) => [
            'seq' => (int) $row->seq,
            'event' => ['type' => $row->type] + (array) ($row->payload ?? []),
        ])->all();
    }

    /** The highest sequence stored for a turn, or 0 when it has emitted nothing. */
    public function latestSequence(string $turnId): int
    {
        return (int) AiTurnEvent::query()->where('turn_id', $turnId)->max('seq');
    }

    /**
     * Block until the turn emits something past `afterSeq`, or the timeout
     * elapses.
     *
     * Returns true when there is probably new work to read. "Probably" is
     * deliberate: the caller re-queries the log either way, so a spurious wake
     * costs one indexed lookup and a missed wake costs at most the poll
     * interval. That is what makes the Redis path an optimisation rather than a
     * dependency — with Redis unavailable this degrades to polling instead of
     * failing.
     */
    public function awaitChange(string $turnId, int $afterSeq, float $timeoutSeconds): bool
    {
        $deadline = microtime(true) + $timeoutSeconds;

        try {
            $connection = Redis::connection();

            while (microtime(true) < $deadline) {
                $latest = (int) $connection->get(self::CHANNEL . $turnId);

                if ($latest > $afterSeq) {
                    return true;
                }

                usleep(200_000);
            }

            return false;
        } catch (\Throwable) {
            // No Redis, or it went away mid-turn. Sleep out the remaining
            // window so the caller polls at its own cadence rather than
            // spinning on a broken connection.
            $remaining = $deadline - microtime(true);

            if ($remaining > 0) {
                usleep((int) ($remaining * 1_000_000));
            }

            return true;
        }
    }

    /**
     * Delete the events for turns older than the retention window.
     *
     * Bounded per call so this can be scheduled without becoming a long lock on
     * a table that one busy turn can add hundreds of rows to.
     */
    public function prune(int $days, int $limit = 5000): int
    {
        return AiTurnEvent::query()
            ->where('created_at', '<', now()->subDays(max(1, $days)))
            ->limit(max(1, $limit))
            ->delete();
    }

    /**
     * The next sequence for a turn.
     *
     * Seeded from storage the first time this process touches a turn, because a
     * resumed turn re-enters under the same id in a different worker and has to
     * continue the numbering rather than restart it.
     */
    private function nextSequence(string $turnId): int
    {
        if (!isset($this->sequences[$turnId])) {
            $this->sequences[$turnId] = $this->latestSequence($turnId);
        }

        return ++$this->sequences[$turnId];
    }

    /**
     * Remove anything a replay is not allowed to carry.
     *
     * Two exclusions, for two different reasons:
     *
     * - `result` on a tool result is the shaped payload the model was handed.
     *   It is live-only by existing policy and a reloaded transcript has never
     *   contained it; storing it here would create the larger second copy that
     *   policy exists to prevent.
     * - `ticket` on a queue frame is a bearer credential for a place in line.
     *   Replaying one to a second reader would hand that place away.
     */
    private function strip(AgentEvent $event): array
    {
        $payload = $event->payload;

        if ($event->type === AgentEvent::TYPE_TOOL_RESULT) {
            unset($payload['result']);
        }

        if ($event->type === AgentEvent::TYPE_QUEUED) {
            unset($payload['ticket'], $payload['retry_after_ms']);
        }

        return $payload;
    }

    /**
     * Publish the new high-water mark.
     *
     * A plain key rather than a pub/sub message: a reader that connects between
     * two frames needs to know where the turn has got to, and a message it was
     * not subscribed for is gone. The key is expired rather than deleted on
     * completion so a crashed turn cannot leave one behind forever.
     */
    private function publish(string $turnId, int $seq): void
    {
        try {
            Redis::connection()->setex(self::CHANNEL . $turnId, 3600, (string) $seq);
        } catch (\Throwable) {
            // Readers fall back to polling the log. Nothing to do here.
        }
    }
}
