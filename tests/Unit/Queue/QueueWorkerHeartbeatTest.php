<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Everest\Services\Queue\QueueWorkerHeartbeat;

/**
 * The heartbeat answers the question queue depth cannot: is anything actually
 * draining this lane. A backlog with a live worker is slow; a backlog with no
 * worker is broken, and they look identical without this.
 */
class QueueWorkerHeartbeatTest extends TestCase
{
    private function heartbeat(): QueueWorkerHeartbeat
    {
        return new QueueWorkerHeartbeat($this->app['cache']->store());
    }

    public function testAWorkerReportsTheQueuesItConsumes(): void
    {
        $this->heartbeat()->beat('redis', 'critical,schedules,mail');

        $workers = $this->heartbeat()->workers();

        $this->assertCount(1, $workers);
        $this->assertSame('redis', $workers[0]['connection']);
        $this->assertSame(['critical', 'schedules', 'mail'], $workers[0]['queues']);
        $this->assertSame(getmypid(), $workers[0]['pid']);
    }

    public function testConsumedQueuesAreCollectedAcrossWorkers(): void
    {
        $this->heartbeat()->beat('redis', 'mail,dns');
        $this->heartbeat()->beat('redis-long', 'mods');

        $consumed = $this->heartbeat()->consumedQueues();

        sort($consumed);
        $this->assertSame(['dns', 'mail', 'mods'], $consumed);
    }

    /**
     * Redis namespaces its queue names; the database driver does not. Both have
     * to resolve to the same name or a lane looks unconsumed.
     */
    public function testNamespacedRedisQueueNamesAreNormalised(): void
    {
        $this->heartbeat()->beat('redis', 'queues:mail');

        $this->assertSame(['mail'], $this->heartbeat()->consumedQueues());
    }

    public function testNothingIsReportedBeforeAnyWorkerHasRun(): void
    {
        $this->assertSame([], $this->heartbeat()->workers());
        $this->assertSame([], $this->heartbeat()->consumedQueues());
    }

    /**
     * `Looping` fires on every pass of the worker loop, which is far too often
     * to write to the cache each time.
     */
    public function testRepeatedBeatsFromOneProcessDoNotWriteEveryTime(): void
    {
        $heartbeat = $this->heartbeat();

        for ($i = 0; $i < 50; ++$i) {
            $heartbeat->beat('redis', 'mail');
        }

        $this->assertCount(1, $heartbeat->workers());
    }

    /**
     * The index used to be written only when a worker key was new, so it
     * expired on its own TTL underneath workers that were still beating. For
     * the seconds until the next beat rebuilt it, the panel saw no workers at
     * all and warned that every lane had lost its consumer -- which is what a
     * worker "dropping offline" every few minutes actually was.
     *
     * A fresh instance per beat because the write throttle is per-process state
     * keyed on microtime, which travelling the clock does not move.
     */
    public function testTheIndexIsKeptAliveByEveryBeatNotJustTheFirst(): void
    {
        // A worker beating steadily, as the loop does, for longer than the index
        // was previously allowed to live.
        for ($elapsed = 0; $elapsed <= 345; $elapsed += 15) {
            $this->heartbeat()->beat('redis', 'mail');
            $this->travel(15)->seconds();
        }

        // Now past the point where an index written only by the first beat would
        // have expired -- while the worker is plainly still alive.
        $this->travel(5)->seconds();

        $this->assertCount(
            1,
            $this->heartbeat()->workers(),
            'The index must be refreshed by every beat, or it expires under live workers and the panel briefly sees none.'
        );
    }

    /**
     * `Looping` fires only between jobs, so a worker inside an hour-long modpack
     * install stops announcing itself 90 seconds in and gets reported as gone at
     * exactly the moment it is busiest.
     */
    public function testAWorkerStaysVisibleForTheLengthOfALongJob(): void
    {
        $heartbeat = $this->heartbeat();

        $heartbeat->beat('redis-long', 'mods');
        $heartbeat->holdThroughJob(3600);

        $this->travel(30)->minutes();

        $this->assertSame(['mods'], $heartbeat->consumedQueues(), 'A worker half an hour into a long job must not be reported as gone.');
    }

    /**
     * The hold is bounded by the job's own timeout: a job that overruns it is
     * killed, so a genuinely dead worker cannot stay hidden beyond that.
     */
    public function testTheHoldExpiresOnceTheJobCouldNoLongerBeRunning(): void
    {
        $heartbeat = $this->heartbeat();

        $heartbeat->beat('redis', 'mail');
        $heartbeat->holdThroughJob(120);

        $this->travel(20)->minutes();

        $this->assertSame([], $heartbeat->consumedQueues());
    }

    public function testHoldingBeforeAnyBeatIsHarmless(): void
    {
        $heartbeat = $this->heartbeat();
        $heartbeat->holdThroughJob(600);

        $this->assertSame([], $heartbeat->workers());
    }

    public function testACacheFailureNeverBreaksTheWorker(): void
    {
        $store = $this->createStub(\Illuminate\Contracts\Cache\Repository::class);
        $store->method('put')->willThrowException(new \RuntimeException('redis is down'));
        $store->method('get')->willReturn([]);

        // The worker's loop calls this; a metrics problem must not stop jobs.
        $heartbeat = new QueueWorkerHeartbeat($store);
        $heartbeat->beat('redis', 'mail');

        // It degrades to reporting nothing rather than throwing.
        $this->assertSame([], $heartbeat->workers());
    }
}
