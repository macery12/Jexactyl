<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Illuminate\Support\Str;
use Illuminate\Queue\Attributes\Timeout;
use Everest\Services\Queue\QueueTopology;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Guards the queue topology as a whole rather than any one job.
 *
 * Two things here are easy to break by accident and expensive to notice:
 *
 *  1. A job that sets its own queue silently bypasses `Queue::route()`, because
 *     Illuminate reads the job's property before consulting the route map. The
 *     job keeps working; it just quietly lands back on one shared lane, which is
 *     the exact failure this whole topology exists to prevent.
 *
 *  2. A job timeout that creeps above its connection's `retry_after` lets a
 *     second worker pick up a job the first is still running.
 *
 * Both are asserted against the supervisors in config/horizon.php, so the
 * routing map and the workers that consume it cannot drift apart.
 */
class QueueTopologyTest extends TestCase
{
    /**
     * Jobs here are dispatched two ways: statically, `SomeJob::dispatch(...)`,
     * which needs `Dispatchable`; and as an instance, `dispatch(new SomeJob)`,
     * which needs nothing. `Everest\Jobs\Job` supplies `Queueable` only, so the
     * first style fails on a job that never took the trait — and it fails at
     * the call site, at runtime, with "call to undefined method", long after
     * every other check in this file has passed the job as sound.
     *
     * Asserted against the call sites rather than against every job, because
     * the trait is not universally correct: `RunTaskJob` dispatches its
     * successor through `DispatchesJobs::dispatch()`, an instance method of the
     * same name that `Dispatchable` would collide with.
     */
    public function testEveryStaticDispatchCallSiteNamesADispatchableJob(): void
    {
        $sites = $this->staticDispatchCallSites();

        $this->assertNotEmpty($sites, 'No static dispatch call sites were found — the test is not actually checking anything.');

        foreach ($sites as [$job, $file, $method]) {
            $reflection = new \ReflectionClass($job);

            $this->assertTrue(
                $reflection->hasMethod($method) && $reflection->getMethod($method)->isStatic(),
                "{$file} calls {$job}::{$method}(), which does not exist. Add `use Illuminate\\Foundation\\Bus\\Dispatchable;` to the job, or dispatch it as an instance."
            );
        }
    }

    /**
     * Every `SomeJob::dispatch*()` in app/, resolved through the calling file's
     * own imports so a short name is never guessed at.
     *
     * @return list<array{0: class-string, 1: string, 2: string}>
     */
    private function staticDispatchCallSites(): array
    {
        $sites = [];

        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app')));

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $source = (string) file_get_contents($file->getPathname());
            $relative = Str::of($file->getPathname())->after(base_path() . '/')->toString();

            preg_match_all('/^use ([^\s;]+);$/m', $source, $imports);

            $resolved = [];
            foreach ($imports[1] as $import) {
                $resolved[Str::afterLast($import, '\\')] = $import;
            }

            preg_match_all('/(?<![\w\\$>])([A-Z]\w+)::(dispatch\w*)\(/', $source, $calls, PREG_SET_ORDER);

            foreach ($calls as [, $short, $method]) {
                $class = $resolved[$short] ?? null;

                if ($class !== null && class_exists($class) && is_subclass_of($class, ShouldQueue::class)) {
                    $sites[] = [$class, $relative, $method];
                }
            }
        }

        sort($sites);

        return $sites;
    }

    public function testEveryQueuedJobIsRoutedToAKnownLane(): void
    {
        $lanes = array_keys($this->topology()->lanes());

        foreach ($this->jobClasses() as $job) {
            $lane = $this->topology()->laneForJob($job);

            $this->assertNotNull($lane, "{$job} is not routed in config/queue.php. Add it to the routing map, or add it here as a deliberate fallback to the standard lane.");
            $this->assertContains($lane, $lanes, "{$job} is routed to unknown lane [{$lane}].");
        }
    }

    /**
     * The precedence trap. `Illuminate\Support\Traits\ReadsClassAttributes`
     * returns the job's own `$queue` before it ever looks at the route map.
     */
    public function testNoJobSetsItsOwnQueue(): void
    {
        foreach ($this->jobClasses() as $job) {
            $default = (new \ReflectionClass($job))->getDefaultProperties()['queue'] ?? null;

            $this->assertNull($default, "{$job} declares a \$queue default, which overrides Queue::route(). Remove it and route the job in config/queue.php.");
        }

        foreach ($this->jobFiles() as $file) {
            $this->assertDoesNotMatchRegularExpression(
                '/\$this->queue\s*=/',
                (string) file_get_contents($file),
                basename($file) . ' assigns $this->queue, which silently overrides Queue::route(). Route it in config/queue.php instead.'
            );
        }
    }

    public function testEveryJobTimeoutStaysBelowItsConnectionRetryAfter(): void
    {
        foreach ($this->jobClasses() as $job) {
            $timeout = $this->declaredTimeout($job);

            if ($timeout === null) {
                continue; // Falls back to the worker's --timeout, asserted below.
            }

            $lane = $this->topology()->laneForJob($job);
            $retryAfter = $this->topology()->retryAfterFor($lane);

            if ($retryAfter === null) {
                continue; // sync/sqs do not use retry_after.
            }

            $this->assertLessThan(
                $retryAfter,
                $timeout,
                "{$job} has a {$timeout}s timeout on lane [{$lane}], whose connection retries after {$retryAfter}s. A job that outlives retry_after can be handed to a second worker while the first is still running it."
            );
        }
    }

    public function testEveryLaneIsConsumedByExactlyOneSupervisor(): void
    {
        $consumers = [];

        foreach ($this->supervisors() as $name => $supervisor) {
            foreach ($supervisor['queue'] as $queue) {
                $consumers[$queue][] = $name;
            }
        }

        foreach ($this->topology()->lanes() as $lane => $queue) {
            $this->assertArrayHasKey($queue, $consumers, "Lane [{$lane}] (queue [{$queue}]) is not consumed by any Horizon supervisor. Jobs routed there would never run.");
            $this->assertCount(1, $consumers[$queue], "Queue [{$queue}] is consumed by more than one supervisor (" . implode(', ', $consumers[$queue] ?? []) . '), so its jobs are not isolated.');
        }
    }

    public function testHorizonUsesResolvedLaneNamesAndConnections(): void
    {
        config([
            'queue.default' => 'custom-short',
            'queue.long_connection' => 'custom-long',
            'queue.connections.custom-short' => ['driver' => 'redis', 'retry_after' => 300],
            'queue.connections.custom-long' => ['driver' => 'redis', 'retry_after' => 3900],
            'queue.lanes' => [
                'critical' => 'custom-critical',
                'schedules' => 'custom-schedules',
                'mail' => 'custom-mail',
                'dns' => 'custom-dns',
                'mods' => 'custom-mods',
                'agent' => 'custom-agent',
                'standard' => 'custom-standard',
            ],
        ]);

        $supervisors = $this->topology()->horizonSupervisors();

        $this->assertSame('custom-short', $supervisors['supervisor-interactive']['connection']);
        $this->assertSame([
            'custom-critical',
            'custom-schedules',
            'custom-mail',
            'custom-dns',
            'custom-standard',
            'high',
            'low',
            'standard',
        ], $supervisors['supervisor-interactive']['queue']);
        $this->assertSame([
            'connection' => 'custom-long',
            'queue' => ['custom-mods'],
        ], $supervisors['supervisor-mods']);
        $this->assertSame([
            'connection' => 'custom-long',
            'queue' => ['custom-agent'],
        ], $supervisors['supervisor-agent']);
    }

    public function testBootedHorizonConfigMatchesTheResolvedTopology(): void
    {
        foreach ($this->topology()->horizonSupervisors() as $name => $expected) {
            $this->assertSame($expected['connection'], config("horizon.defaults.{$name}.connection"));
            $this->assertSame($expected['queue'], config("horizon.defaults.{$name}.queue"));
        }
    }

    /**
     * The legacy lanes predate this topology and nothing routes to them, but a
     * long-lived install can still have jobs sitting on them.
     */
    public function testLegacyQueuesAreStillDrained(): void
    {
        $consumed = array_merge(...array_values(array_column($this->supervisors(), 'queue')));

        foreach (['high', 'low', 'standard'] as $queue) {
            $this->assertContains($queue, $consumed, "No supervisor drains [{$queue}]. Anything queued there before the split would be stranded forever.");
        }
    }

    public function testSupervisorTimeoutsStayBelowTheirConnectionRetryAfter(): void
    {
        foreach ($this->supervisors() as $name => $supervisor) {
            $this->assertNotNull($supervisor['timeout'], "Supervisor [{$name}] sets no timeout, so jobs without one of their own fall back to the framework default.");

            $retryAfter = config("queue.connections.{$supervisor['connection']}.retry_after");

            if ($retryAfter !== null) {
                $this->assertLessThan($retryAfter, $supervisor['timeout'], "Supervisor [{$name}] allows jobs to run for {$supervisor['timeout']}s on a connection retrying after {$retryAfter}s. A job outliving retry_after can be handed to a second worker.");
            }
        }
    }

    /**
     * Horizon force-kills a worker it considers hung once the supervisor
     * timeout elapses, so a supervisor must allow at least as long as the
     * longest job it carries or that job is killed mid-run every time.
     */
    public function testSupervisorsAllowTheirLongestJobToFinish(): void
    {
        foreach ($this->supervisors() as $name => $supervisor) {
            $longest = 0;

            foreach ($supervisor['queue'] as $queue) {
                $lane = $this->topology()->laneForQueue($queue);

                if ($lane !== null) {
                    $longest = max($longest, $this->longestJobTimeoutOn($lane));
                }
            }

            if ($longest > 0) {
                $this->assertGreaterThanOrEqual($longest, $supervisor['timeout'], "Supervisor [{$name}] times out after {$supervisor['timeout']}s but carries a job that may run for {$longest}s.");
            }
        }
    }

    /**
     * A worker on the short connection would migrate a long lane's reservations
     * after the short retry_after and hand a still-running install to a second
     * worker.
     *
     * Asserted against the shipped Redis topology rather than PHPUnit's `sync`
     * connection, which deliberately has no retry_after at all.
     */
    public function testLongLanesAreConsumedOnAConnectionThatOutlivesTheirJobs(): void
    {
        config([
            'queue.default' => 'redis',
            'queue.long_connection' => 'redis-long',
        ]);

        foreach ($this->topology()->horizonSupervisors() as $name => $values) {
            config([
                "horizon.defaults.{$name}.connection" => $values['connection'],
                "horizon.defaults.{$name}.queue" => $values['queue'],
            ]);
        }

        foreach ($this->topology()->lanes() as $lane => $queue) {
            if (!$this->topology()->isLong($lane)) {
                continue;
            }

            $longest = $this->longestJobTimeoutOn($lane);

            foreach ($this->supervisors() as $name => $supervisor) {
                if (!in_array($queue, $supervisor['queue'], true)) {
                    continue;
                }

                $connection = $supervisor['connection'];

                $this->assertNotNull($connection, "Supervisor [{$name}] consumes long lane [{$lane}] without naming a connection, so it would inherit the short retry_after.");

                $retryAfter = config("queue.connections.{$connection}.retry_after");

                $this->assertNotNull($retryAfter, "Supervisor [{$name}] names connection [{$connection}], which is not defined in config/queue.php.");
                $this->assertGreaterThan(
                    $longest,
                    $retryAfter,
                    "Supervisor [{$name}] consumes lane [{$lane}] on connection [{$connection}] (retry_after {$retryAfter}s), but a job there may run for {$longest}s. The reservation would expire mid-run and a second worker could pick it up."
                );
            }
        }
    }

    private function longestJobTimeoutOn(string $lane): int
    {
        $timeouts = [0];

        foreach ($this->jobClasses() as $job) {
            if ($this->topology()->laneForJob($job) === $lane) {
                $timeouts[] = $this->declaredTimeout($job) ?? 0;
            }
        }

        return max($timeouts);
    }

    private function topology(): QueueTopology
    {
        return $this->app->make(QueueTopology::class);
    }

    /**
     * The timeout baked into the payload at dispatch: the `#[Timeout]`
     * attribute, else the declared property default.
     */
    private function declaredTimeout(string $job): ?int
    {
        $reflection = new \ReflectionClass($job);

        $attributes = $reflection->getAttributes(Timeout::class);

        if ($attributes !== []) {
            return $attributes[0]->newInstance()->timeout;
        }

        $default = $reflection->getDefaultProperties()['timeout'] ?? null;

        return is_int($default) ? $default : null;
    }

    /**
     * @return list<class-string>
     */
    private function jobClasses(): array
    {
        $classes = [];

        foreach ($this->jobFiles() as $file) {
            $class = 'Everest\\Jobs\\' . str_replace('/', '\\', Str::of($file)->after('app/Jobs/')->before('.php')->toString());

            if (class_exists($class) && is_subclass_of($class, ShouldQueue::class)) {
                $classes[] = $class;
            }
        }

        $this->assertNotEmpty($classes, 'No queued jobs were discovered — the test is not actually checking anything.');

        return $classes;
    }

    /**
     * @return list<string>
     */
    private function jobFiles(): array
    {
        $files = [];

        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app/Jobs')));

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = Str::of($file->getPathname())->after(base_path() . '/')->toString();
            }
        }

        sort($files);

        return $files;
    }

    /**
     * The Horizon supervisors as deployed, defaults merged with the current
     * environment's overrides -- the same resolution Horizon itself performs.
     *
     * @return array<string, array{queue: list<string>, timeout: ?int, connection: ?string}>
     */
    private function supervisors(): array
    {
        $defaults = config('horizon.defaults', []);
        $environment = config('horizon.environments.' . config('app.env'), config('horizon.environments.*', []));

        $supervisors = [];

        foreach ($defaults as $name => $supervisor) {
            $supervisor = array_merge($supervisor, $environment[$name] ?? []);

            $supervisors[$name] = [
                'queue' => (array) ($supervisor['queue'] ?? []),
                'timeout' => isset($supervisor['timeout']) ? (int) $supervisor['timeout'] : null,
                'connection' => $supervisor['connection'] ?? null,
            ];
        }

        $this->assertNotEmpty($supervisors, 'No Horizon supervisors are configured, so nothing would process any queue.');

        return $supervisors;
    }
}
