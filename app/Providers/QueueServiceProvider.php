<?php

namespace Everest\Providers;

use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\ServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Everest\Services\Queue\QueueTopology;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Services\Queue\QueueWaitEstimator;
use Illuminate\Console\Events\CommandStarting;
use Everest\Services\Queue\QueueWorkerHeartbeat;
use Everest\Services\Queue\HorizonEnvironmentGuard;

/**
 * Wires the panel's queue topology.
 *
 * Two halves that are easy to confuse: Horizon supervises worker *processes*
 * (config/horizon.php), while this provider decides which *queue* each job
 * lands on (config/queue.php). Horizon has no opinion about routing.
 *
 * Jobs deliberately do not name their own queue. Note the precedence trap that
 * depends on: Queue::route() is consulted only when the job has no queue of its
 * own, so a job assigning $this->queue in its constructor silently bypasses the
 * map entirely (Illuminate\Support\Traits\ReadsClassAttributes::getAttributeValue).
 * QueueTopologyTest asserts that none do.
 */
class QueueServiceProvider extends ServiceProvider
{
    /** Commands that start worker processes and must not run in a broken environment. */
    private const WORKER_COMMANDS = ['horizon', 'horizon:work', 'horizon:supervisor'];

    public function register(): void
    {
        $this->app->singleton(QueueTopology::class, fn ($app) => new QueueTopology($app['config']));

        $this->app->singleton(HorizonEnvironmentGuard::class, fn ($app) => new HorizonEnvironmentGuard($app['config'], $app['cache']->store()));

        $this->app->singleton(QueueWorkerHeartbeat::class, fn ($app) => new QueueWorkerHeartbeat($app['cache']->store()));

        $this->app->singleton(QueueWaitEstimator::class, fn ($app) => new QueueWaitEstimator($app['config'], $app->make(QueueTopology::class)));
    }

    public function boot(): void
    {
        $this->registerRoutes();
        $this->registerRateLimiters();
        $this->registerHeartbeat();
        $this->guardWorkerStartup();
        $this->sizeConditionalSupervisors();
        $this->configureHorizon();
    }

    /**
     * Apply the job class => [connection, queue] map.
     */
    private function registerRoutes(): void
    {
        $routes = $this->app->make(QueueTopology::class)->routes();

        if ($routes !== []) {
            Queue::route($routes);
        }
    }

    /**
     * Named limiters consumed by `RateLimited` job middleware.
     */
    private function registerRateLimiters(): void
    {
        RateLimiter::for('cloudflare', function () {
            $perMinute = (int) config('modules.custom_domains.rate_limits.cloudflare_jobs_per_minute', 60);

            return $perMinute > 0 ? Limit::perMinute($perMinute) : Limit::none();
        });
    }

    /**
     * Every worker announces itself from its own loop, so the panel can tell
     * which lanes have a live consumer.
     *
     * `Looping` fires inside Horizon's workers too -- they are ordinary Laravel
     * workers under a different supervisor -- so this reports real processes
     * rather than configured ones. That is what catches a supervisor sized to
     * zero, or one that died.
     */
    private function registerHeartbeat(): void
    {
        $this->app['events']->listen(Looping::class, function (Looping $event) {
            $this->app->make(QueueWorkerHeartbeat::class)->beat($event->connectionName, $event->queue);
        });

        // Looping stops for the duration of a job, so a worker part-way through
        // an hour-long modpack install would otherwise be declared dead 90
        // seconds in. Extend the record to cover the job before it starts.
        $this->app['events']->listen(JobProcessing::class, function (JobProcessing $event) {
            $this->app->make(QueueWorkerHeartbeat::class)->holdThroughJob($event->job->timeout());
        });
    }

    /**
     * Refuse to start a worker into an environment where it would do nothing.
     *
     * Horizon started against a database queue, a clustered Redis, or a host
     * without pcntl comes up looking healthy and processes not one job. Failing
     * at startup with the reason is far kinder than letting an operator find
     * out when a customer reports a missing invoice.
     */
    private function guardWorkerStartup(): void
    {
        $this->app['events']->listen(CommandStarting::class, function (CommandStarting $event) {
            if (!in_array($event->command, self::WORKER_COMMANDS, true)) {
                return;
            }

            $problems = $this->app->make(HorizonEnvironmentGuard::class)->problems();

            if ($problems === []) {
                return;
            }

            $output = $event->output;
            $output->writeln('');
            $output->writeln('  <error> The queue worker cannot start in this environment. </error>');
            $output->writeln('');

            foreach ($problems as $problem) {
                $output->writeln("  <fg=red>-</> {$problem['problem']}");
                $output->writeln("    <fg=gray>Fix:</> {$problem['fix']}");
                $output->writeln('');
            }

            $output->writeln('  See docs/queues.md, or run <comment>php artisan p:queue:health</comment> for the full picture.');
            $output->writeln('');

            // A hard stop is the point: starting anyway is the failure mode
            // this guard exists to prevent.
            exit(1);
        });
    }

    /**
     * Staff the mods supervisor only when mods are actually enabled.
     *
     * This has to happen in a `booted` callback rather than in
     * config/horizon.php. Module flags can be toggled by an admin at runtime,
     * and SettingsServiceProvider layers those overrides onto config during
     * boot -- long after the config files themselves were evaluated. Reading
     * the flag any earlier would size the supervisor from the .env default and
     * quietly leave the lane unstaffed on an install that has mods switched on
     * in the panel.
     *
     * Horizon reads its provisioning plan when the command runs, so setting it
     * here is in time.
     */
    private function sizeConditionalSupervisors(): void
    {
        $this->app->booted(function () {
            $expected = $this->app->make(QueueTopology::class)->isExpected('mods');

            config(['horizon.defaults.supervisor-mods.processes' => $expected ? 1 : 0]);
        });
    }

    /**
     * Horizon's own dashboard stays shut. Queue health is served by
     * /admin/queues, which reads the same repositories and renders them in the
     * panel's own UI -- one admin surface, one theme, one permission model.
     *
     * An operator who wants the upstream dashboard can widen this gate.
     */
    private function configureHorizon(): void
    {
        Gate::define('viewHorizon', fn ($user = null) => false);
    }
}
