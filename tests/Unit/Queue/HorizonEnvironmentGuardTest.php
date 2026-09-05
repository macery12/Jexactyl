<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Everest\Services\Queue\HorizonEnvironmentGuard;

/**
 * Horizon supervises Redis queues and nothing else. Started anywhere it cannot
 * work it comes up looking healthy and processes not one job, so these are the
 * conditions the worker refuses to start on.
 */
class HorizonEnvironmentGuardTest extends TestCase
{
    /** Mirrors HorizonEnvironmentGuard::CAPABILITY_KEY, which is private by design. */
    private const CAPABILITY_KEY = 'queue:env:worker-functions-missing';

    private function guard(string $sapi = 'cli'): HorizonEnvironmentGuard
    {
        return new HorizonEnvironmentGuard($this->app['config'], $this->app['cache']->store(), $sapi);
    }

    private function useRedisQueue(): void
    {
        config([
            'queue.default' => 'redis',
            'queue.connections.redis' => ['driver' => 'redis', 'connection' => 'default', 'retry_after' => 300],
            'queue.connections.redis-long' => ['driver' => 'redis', 'connection' => 'default', 'retry_after' => 3900],
            'horizon.defaults.supervisor-mods.connection' => 'redis-long',
            'database.redis.clusters' => null,
        ]);
    }

    public function testAProperlyConfiguredRedisInstallIsSupported(): void
    {
        $this->useRedisQueue();

        $this->assertSame([], $this->guard()->problems());
        $this->assertTrue($this->guard()->isSupported());
    }

    public function testANonRedisQueueIsRefused(): void
    {
        $this->useRedisQueue();
        config(['queue.default' => 'database', 'queue.connections.database' => ['driver' => 'database']]);

        $codes = array_column($this->guard()->problems(), 'code');

        $this->assertContains('queue_driver', $codes);
        $this->assertFalse($this->guard()->isSupported());
    }

    /**
     * `database.redis.options.cluster` names the clustering *strategy* and is
     * populated by default, so it must not be mistaken for clustering being on.
     * Only a connection defined under `clusters` is actually clustered.
     */
    public function testTheDefaultClusterStrategyKeyIsNotMistakenForAClusteredRedis(): void
    {
        $this->useRedisQueue();
        config(['database.redis.options.cluster' => 'redis']);

        $this->assertSame([], $this->guard()->problems());
    }

    public function testAClusteredRedisIsRefused(): void
    {
        $this->useRedisQueue();
        config(['database.redis.clusters.default' => [['host' => '127.0.0.1']]]);

        $this->assertContains('redis_cluster', array_column($this->guard()->problems(), 'code'));
    }

    /**
     * Losing the long connection would put hour-long modpack installs on a
     * connection that reclaims them after five minutes, handing a running
     * install to a second worker.
     */
    public function testAMissingLongConnectionIsRefused(): void
    {
        $this->useRedisQueue();
        config(['queue.connections.redis-long' => null]);

        $this->assertContains('missing_long_connection', array_column($this->guard()->problems(), 'code'));
    }

    /**
     * Debian and Ubuntu compile pcntl into the CLI SAPI only -- there is no
     * pcntl.so for PHP-FPM to load -- so every admin page view finds pcntl_fork
     * missing on a host whose worker has it and is running fine. Probing the
     * serving process reported healthy installs as broken, and sent operators
     * looking through a disable_functions list that was empty.
     */
    public function testAWebRequestDoesNotJudgeTheWorkerByItsOwnMissingFunctions(): void
    {
        $this->useRedisQueue();
        $this->app['cache']->store()->forget(self::CAPABILITY_KEY);

        $this->assertNotContains('missing_functions', array_column($this->guard('fpm-fcgi')->problems(), 'code'));
    }

    public function testAWebRequestReportsWhatTheCliActuallyObserved(): void
    {
        $this->useRedisQueue();
        $this->app['cache']->store()->put(self::CAPABILITY_KEY, ['pcntl_fork'], 60);

        $problems = collect($this->guard('fpm-fcgi')->problems())->firstWhere('code', 'missing_functions');

        $this->assertNotNull($problems, 'A finding recorded by the CLI must still reach the admin page.');
        $this->assertStringContainsString('pcntl_fork', $problems['problem']);
        $this->assertStringContainsString('CLI', $problems['problem']);
    }

    public function testTheCliRecordsItsFindingSoTheWebHasSomethingToRead(): void
    {
        $this->useRedisQueue();
        $this->app['cache']->store()->forget(self::CAPABILITY_KEY);

        $this->guard()->problems();

        $this->assertIsArray($this->app['cache']->store()->get(self::CAPABILITY_KEY));
    }

    /**
     * A host that gets fixed has to clear itself; an operator should not have to
     * know there is a cache key behind the warning.
     */
    public function testAStaleFindingIsClearedByTheNextCliRun(): void
    {
        if (!function_exists('pcntl_fork')) {
            $this->markTestSkipped('This host genuinely lacks pcntl, so there is no stale finding to clear.');
        }

        $this->useRedisQueue();
        $this->app['cache']->store()->put(self::CAPABILITY_KEY, ['pcntl_fork'], 60);

        $this->assertNotContains('missing_functions', array_column($this->guard()->problems(), 'code'));
        $this->assertSame([], $this->app['cache']->store()->get(self::CAPABILITY_KEY));
        $this->assertNotContains('missing_functions', array_column($this->guard('fpm-fcgi')->problems(), 'code'));
    }

    public function testEveryProblemCarriesAnActionableFix(): void
    {
        $this->useRedisQueue();
        config(['queue.default' => 'sync', 'queue.connections.sync' => ['driver' => 'sync']]);

        foreach ($this->guard()->problems() as $problem) {
            $this->assertNotEmpty($problem['problem']);
            $this->assertNotEmpty($problem['fix'], "Problem [{$problem['code']}] tells an operator what is wrong but not what to do about it.");
        }
    }
}
