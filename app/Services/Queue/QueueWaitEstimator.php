<?php

namespace Everest\Services\Queue;

use Illuminate\Contracts\Config\Repository as Config;

/**
 * How long each lane will take to clear, and when that is too long.
 *
 * Horizon models this as `readyNow(queue) * runtimeForQueue(queue)`, but the
 * latter reads a live counter `horizon:snapshot` deletes every five minutes, so
 * it collapses to zero however deep the queue is. The caller supplies a runtime
 * from the retained snapshots instead; this applies the rest of the model,
 * keeping two of its properties:
 *
 *  - **Cumulative** in the supervisor's declared queue order — under
 *    `balance => false` a low-priority lane really does wait for those above it,
 *    so reporting lanes in isolation would understate all but the first.
 *  - Divided by the supervisor's process count, since those drain in parallel.
 */
class QueueWaitEstimator
{
    /** Horizon's own fallback for a queue with no threshold of its own. */
    private const DEFAULT_THRESHOLD_SECONDS = 60;

    public function __construct(private Config $config, private QueueTopology $topology)
    {
    }

    /**
     * Queue name => estimated seconds to clear, or null when it cannot be known.
     * Null is not zero: a lane holding work with no runtime sample is genuinely
     * unknowable, and reporting it as instant is how a real backlog hides.
     *
     * @param array<string, ?float> $clearMs queue name => ms to drain, null when unknowable
     * @param list<array<string, mixed>> $supervisors each with `queues` in priority order and a `processes` count
     *
     * @return array<string, ?int>
     */
    public function estimate(array $clearMs, array $supervisors): array
    {
        $waits = [];

        foreach ($supervisors as $supervisor) {
            // A supervisor reporting zero processes is either starting up or
            // scaled to nothing. Dividing by zero is not an option, and the
            // undivided figure is the honest answer for a single process.
            $processes = max(1, (int) ($supervisor['processes'] ?? 0));
            $cumulative = 0.0;
            $known = true;

            foreach (($supervisor['queues'] ?? []) as $queue) {
                // Absent and null mean different things and `??` conflates
                // them. Legacy lanes (`high`, `low`) are drained but never
                // routed to, so they are absent and count as empty -- they only
                // hold work queued before the split. A lane that is present but
                // null is a measured lane whose runtime is not yet known.
                $present = array_key_exists($queue, $clearMs);
                $lane = $present ? $clearMs[$queue] : 0.0;

                if ($lane === null) {
                    // Unknowable at this point makes everything behind it
                    // unknowable too, rather than optimistically short.
                    $known = false;
                } else {
                    $cumulative += $lane;
                }

                if ($present) {
                    $waits[$queue] = $known ? (int) round($cumulative / $processes / 1000) : null;
                }
            }
        }

        return $waits;
    }

    /**
     * The lane's wait target from `horizon.waits`, or null when it has none.
     *
     * These thresholds have never fired upstream. Horizon's own
     * MonitorWaitTimes keys them by `array_keys($supervisor->processes)`, which
     * for a `balance => false` supervisor is the whole comma-joined queue group
     * -- so a key naming a single lane matches nothing. Reading them per lane
     * here is the only way the values in config/horizon.php are ever honoured.
     */
    public function thresholdFor(string $lane, string $queue): ?int
    {
        $configured = $this->config->get(
            "horizon.waits.{$this->topology->resolvedConnectionFor($lane)}:{$queue}"
        );

        // Horizon's convention, kept so the config behaves as documented
        // upstream: an explicit 0 disables the check, absent falls back to 60s.
        if ($configured === 0) {
            return null;
        }

        return $configured === null ? self::DEFAULT_THRESHOLD_SECONDS : (int) $configured;
    }
}
