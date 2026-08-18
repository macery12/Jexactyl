<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\AiUsageLog;
use Illuminate\Support\Facades\Log;

/**
 * Stopping a turn that is already running.
 *
 * Pressing Stop used to abort the browser's `fetch` and nothing else. The turn
 * went on thinking, went on spending the user's budget, and — the part that
 * actually matters — went on running tools, against a reader who had said they
 * wanted it to stop. "Stop watching" is not "stop".
 *
 * Two properties this has to hold, and they pull in opposite directions:
 *
 * 1. **A stop must survive the request that asked for it.** The asking request
 *    and the running turn are different PHP processes; a flag in memory reaches
 *    nobody. The record is a column on the turn's own usage row, which is
 *    already the durable, ownership-qualified account of the turn.
 * 2. **A stop must never arrive mid-effect.** Tools are HTTP calls through the
 *    panel's own middleware, several of them against a remote node. There is no
 *    point at which one can be un-started, so cancellation is only ever
 *    *observed* at a boundary where nothing is half-done: between steps, before
 *    a call is dispatched, and between the children of a batch. A tool already
 *    in flight always finishes and always reports.
 *
 * The consequence is that a cancel is a request, not an instruction, and the
 * two columns say so: `cancel_requested_at` is when the user asked, and the
 * `cancelled` status is when the turn actually stopped. An operator reading a
 * turn that took nine more seconds to stop can see why.
 *
 * Reads are throttled rather than cached in the request container, because the
 * whole point is to observe a write made by a *different* process — memoising a
 * negative would make the flag unobservable for the life of the turn. Only the
 * positive is memoised, since cancellation does not un-happen.
 */
class TurnCancellations
{
    /**
     * How stale an unobserved cancellation may be.
     *
     * A turn checks at boundaries that are usually seconds apart, so this is
     * rarely the binding constraint; it exists so a fast batch of small calls
     * cannot turn one flag into a query per child.
     */
    private const RECHECK_SECONDS = 1.0;

    /** @var array<string, bool> */
    private array $cancelled = [];

    /** @var array<string, float> */
    private array $lastReadAt = [];

    /**
     * Ask a running turn to stop.
     *
     * Conditional on the row still being `running`, so two people racing the
     * button produce one request, and a turn that finished on its own in the
     * meantime is not retroactively marked as cancelled. A suspended turn is
     * deliberately not cancellable here: nothing is executing, and the decision
     * the user actually wants is to decline the approval that is on screen.
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
            Log::warning('Could not read the cancellation flag for AI turn ' . $turnId . ': ' . $e->getMessage());

            return false;
        }

        return $this->cancelled[$turnId] = $asked;
    }
}
