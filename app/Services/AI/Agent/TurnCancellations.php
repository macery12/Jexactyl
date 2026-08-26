<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\AiUsageLog;
use Illuminate\Support\Facades\Log;

/**
 * Stopping a turn that is already running. Two properties pull in opposite
 * directions:
 *
 * 1. **A stop must survive the request that asked for it.** Asker and turn are
 *    different PHP processes, so the record is a column on the turn's usage row
 *    rather than a flag in memory.
 * 2. **A stop must never arrive mid-effect.** Tools are HTTP calls that cannot
 *    be un-started, so cancellation is only *observed* where nothing is
 *    half-done: between steps, before a dispatch, and between batch children. A
 *    tool in flight always finishes and reports.
 *
 * So a cancel is a request, not an instruction, and the columns say so:
 * `cancel_requested_at` is when the user asked, the `cancelled` status is when
 * the turn actually stopped.
 *
 * Reads are throttled rather than memoised, since the point is to observe a
 * write from a *different* process; only the positive is cached, as
 * cancellation does not un-happen.
 */
class TurnCancellations
{
    /**
     * How stale an unobserved cancellation may be. Rarely the binding constraint
     * — boundaries are seconds apart — but it stops a fast batch of small calls
     * turning one flag into a query per child.
     */
    private const RECHECK_SECONDS = 1.0;

    /** @var array<string, bool> */
    private array $cancelled = [];

    /** @var array<string, float> */
    private array $lastReadAt = [];

    /**
     * Ask a running turn to stop. Conditional on the row still being `running`,
     * so racing clicks produce one request and a turn that already finished is
     * not retroactively cancelled. A suspended turn is not cancellable here —
     * nothing is executing, and the user wants to decline the card on screen.
     *
     * @return bool whether this call is the one that recorded the request
     */
    public function request(AiUsageLog $usage): bool
    {
        $recorded = AiUsageLog::whereKey($usage->id)
            ->where('status', 'running')
            ->whereNull('cancel_requested_at')
            ->update(['cancel_requested_at' => now()]);

        if ($recorded === 1) {
            $this->cancelled[(string) $usage->turn_id] = true;
        }

        return $recorded === 1;
    }

    /**
     * Whether the user has asked for this turn to stop.
     */
    public function requested(string $turnId): bool
    {
        if ($this->cancelled[$turnId] ?? false) {
            return true;
        }

        $now = microtime(true);
        if ($now - ($this->lastReadAt[$turnId] ?? 0.0) < self::RECHECK_SECONDS) {
            return false;
        }

        $this->lastReadAt[$turnId] = $now;

        try {
            $asked = AiUsageLog::query()
                ->where('turn_id', $turnId)
                ->whereNotNull('cancel_requested_at')
                ->exists();
        } catch (\Throwable $e) {
            // Fail open, deliberately. This read is the *delivery* of a stop,
            // not the record of one — the record is the column, and it stays
            // written. A database that cannot answer is not evidence that the
            // user pressed Stop, and treating it as though it were would end
            // every turn in flight the moment the connection wobbled.
            Log::warning('Could not read the cancellation flag for an AI turn.', [
                'turn' => $turnId,
                'exception' => $e::class,
            ]);

            return false;
        }

        return $this->cancelled[$turnId] = $asked;
    }
}
