<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Everest\Services\Queue\QueueTopology;
use Everest\Services\Queue\QueueWaitEstimator;

/**
 * Queue depth says how much is waiting; this says how long it will be waiting
 * for, which is the number an operator actually reacts to. Ten jobs is nothing
 * on `mail` and a serious backlog on `mods`.
 */
class QueueWaitEstimatorTest extends TestCase
{
    private function estimator(): QueueWaitEstimator
    {
        return new QueueWaitEstimator($this->app['config'], $this->app->make(QueueTopology::class));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function supervisor(array $queues, int $processes = 1): array
    {
        return [['queues' => $queues, 'processes' => $processes]];
    }

    /**
     * Under `balance => false` the supervisor works its queues in strict order,
     * so a job on a lower lane waits for every lane above it to drain first.
     * Reporting each lane on its own would understate all but the first.
     */
    public function testWaitAccumulatesDownThePriorityOrder(): void
    {
        $waits = $this->estimator()->estimate(
            ['critical' => 10_000.0, 'mail' => 5_000.0, 'dns' => 5_000.0],
            $this->supervisor(['critical', 'mail', 'dns']),
        );

        $this->assertSame(10, $waits['critical']);
        $this->assertSame(15, $waits['mail'], 'A job on mail also waits for critical to clear.');
        $this->assertSame(20, $waits['dns']);
    }

    public function testProcessesDrainTheGroupInParallel(): void
    {
        $waits = $this->estimator()->estimate(
            ['critical' => 60_000.0],
            $this->supervisor(['critical'], processes: 4),
        );

        $this->assertSame(15, $waits['critical']);
    }

    /**
     * A supervisor that reports no processes is starting up or scaled to zero.
     * Dividing by it is not an option and the undivided figure is the honest
     * answer, so it must not blow up or silently report nothing.
     */
    public function testASupervisorWithNoProcessesStillProducesAnEstimate(): void
    {
        $waits = $this->estimator()->estimate(
            ['mods' => 30_000.0],
            $this->supervisor(['mods'], processes: 0),
        );

        $this->assertSame(30, $waits['mods']);
    }

    public function testAnEmptyLaneClearsInstantly(): void
    {
        $waits = $this->estimator()->estimate(['mail' => 0.0], $this->supervisor(['mail']));

        $this->assertSame(0, $waits['mail']);
    }

    /**
     * The bug this whole estimator exists for. Horizon derives wait from the
     * live runtime counter, which `horizon:snapshot` deletes every five minutes
     * -- so a deep queue reports a 0s wait for minutes at a time. Null has to
     * mean "cannot be known", because reporting it as instant is exactly how a
     * real backlog hides.
     */
    public function testALaneWithNoRuntimeSampleIsUnknownRatherThanInstant(): void
    {
        $waits = $this->estimator()->estimate(['mail' => null], $this->supervisor(['mail']));

        $this->assertNull($waits['mail'], 'A lane holding work with no runtime sample must not report 0s.');
    }

    public function testAnUnknownLaneMakesEverythingBehindItUnknownToo(): void
    {
        $waits = $this->estimator()->estimate(
            ['critical' => null, 'mail' => 1_000.0],
            $this->supervisor(['critical', 'mail']),
        );

        $this->assertNull($waits['critical']);
        $this->assertNull($waits['mail'], 'Work queued behind an unmeasurable lane cannot be estimated optimistically.');
    }

    /**
     * `high` and `low` are still drained so pre-split work runs, but nothing
     * routes to them and they carry no metrics. They must not appear as lanes,
     * and must not derail the running total for the lanes below them.
     */
    public function testLegacyQueuesAreDrainedWithoutBeingReported(): void
    {
        $waits = $this->estimator()->estimate(
            ['critical' => 2_000.0, 'standard' => 3_000.0],
            $this->supervisor(['critical', 'high', 'standard', 'low']),
        );

        $this->assertArrayNotHasKey('high', $waits);
        $this->assertArrayNotHasKey('low', $waits);
        $this->assertSame(5, $waits['standard']);
    }

    public function testALaneNoSupervisorDrainsGetsNoEstimate(): void
    {
        $waits = $this->estimator()->estimate(['mods' => 9_000.0], $this->supervisor(['mail']));

        $this->assertArrayNotHasKey('mods', $waits);
    }

    public function testEachSupervisorAccumulatesIndependently(): void
    {
        $waits = $this->estimator()->estimate(
            ['critical' => 4_000.0, 'mods' => 4_000.0],
            [
                ['queues' => ['critical'], 'processes' => 1],
                ['queues' => ['mods'], 'processes' => 1],
            ],
        );

        $this->assertSame(4, $waits['critical']);
        $this->assertSame(4, $waits['mods'], 'The mods supervisor is isolated; its wait must not include the interactive lanes.');
    }

    public function testAConfiguredThresholdIsUsed(): void
    {
        config(['queue.default' => 'redis', 'horizon.waits.redis:critical' => 30]);

        $this->assertSame(30, $this->estimator()->thresholdFor('critical', 'critical'));
    }

    /**
     * Horizon's own convention, kept so the config behaves as its documentation
     * says rather than as this panel happens to read it.
     */
    public function testAnExplicitZeroDisablesTheCheck(): void
    {
        config(['queue.default' => 'redis', 'horizon.waits.redis:dns' => 0]);

        $this->assertNull($this->estimator()->thresholdFor('dns', 'dns'));
    }

    public function testAnUnlistedQueueFallsBackToHorizonsDefault(): void
    {
        config(['queue.default' => 'redis', 'horizon.waits' => []]);

        $this->assertSame(60, $this->estimator()->thresholdFor('standard', 'standard'));
    }

    /**
     * `mods` is consumed on the long connection, so its threshold is keyed by
     * that connection. Reading it against the default one would silently apply
     * the wrong target -- or none at all.
     */
    public function testALongLaneReadsTheThresholdForItsOwnConnection(): void
    {
        config([
            'queue.default' => 'redis',
            'queue.connections.redis-long' => ['driver' => 'redis', 'retry_after' => 3900],
            'horizon.waits' => ['redis:mods' => 30, 'redis-long:mods' => 900],
        ]);

        $this->assertSame(900, $this->estimator()->thresholdFor('mods', 'mods'));
    }
}
