<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Illuminate\Support\Carbon;
use Everest\Services\Schedules\SchedulerHeartbeat;

/**
 * Cron is the half of "is this panel healthy" that the queue cannot see.
 *
 * The staleness thresholds are the whole point of the feature, so they are
 * asserted rather than trusted: a heartbeat that never reports "down" is worse
 * than no heartbeat at all, because it turns a monitored system into one that
 * looks monitored.
 */
class SchedulerHeartbeatTest extends TestCase
{
    private function heartbeat(): SchedulerHeartbeat
    {
        return new SchedulerHeartbeat($this->app['cache']->store());
    }

    public function testNeverSeenIsNotReportedAsAnOutage(): void
    {
        $snapshot = $this->heartbeat()->snapshot();

        // A panel that started a minute ago has no heartbeat yet, and that is
        // not evidence of a missing cron entry.
        $this->assertSame('unknown', $snapshot['severity']);
        $this->assertNull($snapshot['ranAt']);
        $this->assertNull($snapshot['secondsAgo']);
    }

    public function testABeatIsHealthy(): void
    {
        $this->heartbeat()->beat();

        $snapshot = $this->heartbeat()->snapshot();

        $this->assertSame('ok', $snapshot['severity']);
        $this->assertSame(0, $snapshot['secondsAgo']);
    }

    public function testItGoesStaleThenDown(): void
    {
        $this->heartbeat()->beat();

        Carbon::setTestNow(now()->addSeconds(SchedulerHeartbeat::STALE_SECONDS + 1));
        $this->assertSame('stale', $this->heartbeat()->snapshot()['severity']);

        Carbon::setTestNow(now()->addSeconds(SchedulerHeartbeat::CRITICAL_SECONDS));
        $this->assertSame('down', $this->heartbeat()->snapshot()['severity']);

        Carbon::setTestNow();
    }

    public function testTaskNamesLoseTheirBinaryAndArtisanPath(): void
    {
        $this->heartbeat()->recordFinished("/usr/bin/php8.3 '/var/www/panel/artisan' p:schedule:process", 84.6);

        $recent = $this->heartbeat()->snapshot()['recent'];

        $this->assertSame('p:schedule:process', $recent[0]['task']);
        $this->assertSame(85, $recent[0]['runtimeMs']);
        $this->assertTrue($recent[0]['ok']);
    }

    /**
     * A per-minute task would otherwise fill the whole ring within ten minutes
     * and hide every daily one.
     */
    public function testOneEntryPerTaskNewestFirst(): void
    {
        $heartbeat = $this->heartbeat();

        $heartbeat->recordFinished('p:schedule:process', 10);
        $heartbeat->recordFinished('billing:cleanup', 20);
        $heartbeat->recordFinished('p:schedule:process', 30);

        $recent = $heartbeat->snapshot()['recent'];

        $this->assertCount(2, $recent);
        $this->assertSame('p:schedule:process', $recent[0]['task']);
        $this->assertSame(30, $recent[0]['runtimeMs']);
    }

    public function testAFailureIsKeptSeparatelyFromTheRing(): void
    {
        $heartbeat = $this->heartbeat();

        $heartbeat->recordFailed('billing:suspend', 'Connection refused');

        $snapshot = $heartbeat->snapshot();

        $this->assertFalse($snapshot['recent'][0]['ok']);
        $this->assertSame('billing:suspend', $snapshot['lastFailure']['task']);
        $this->assertSame('Connection refused', $snapshot['lastFailure']['error']);
    }

    /** A stack trace has no business in a cache entry rendered into a page. */
    public function testFailureMessagesAreBounded(): void
    {
        $this->heartbeat()->recordFailed('billing:suspend', str_repeat('x', 5000));

        $this->assertSame(500, mb_strlen($this->heartbeat()->snapshot()['lastFailure']['error']));
    }
}
