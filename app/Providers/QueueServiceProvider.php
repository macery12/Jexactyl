<?php

namespace Everest\Providers;

use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Queue;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\ServiceProvider;
use Everest\Services\Queue\JobCatalogue;
use Illuminate\Cache\RateLimiting\Limit;
use Everest\Services\Queue\QueueTopology;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Services\Queue\QueueWaitEstimator;
use Illuminate\Console\Events\CommandStarting;
use Everest\Services\Queue\QueueWorkerHeartbeat;
use Everest\Services\Schedules\SchedulerHeartbeat;
use Illuminate\Console\Events\ScheduledTaskFailed;
use Everest\Services\Queue\HorizonEnvironmentGuard;
use Illuminate\Console\Events\ScheduledTaskFinished;

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

        $this->app->singleton(SchedulerHeartbeat::class, fn ($app) => new SchedulerHeartbeat($app['cache']->store()));

        $this->app->singleton(JobCatalogue::class, fn ($app) => new JobCatalogue($app['config'], $app->make(QueueTopology::class)));

        $this->app->singleton(QueueWaitEstimator::class, fn ($app) => new QueueWaitEstimator($app['config'], $app->make(QueueTopology::class)));
    }

    public function boot(): void
    {
        $this->configureSupervisorTopology();
        $this->registerRoutes();
        $this->registerRateLimiters();
        $this->registerHeartbeat();
        $this->registerSchedulerHeartbeat();
        $this->guardWorkerStartup();
        $this->sizeConditionalSupervisors();
        $this->configureHorizon();
    }

    /**
     * Point Horizon at the same resolved queue names and connections used for
     * dispatch. This keeps every documented QUEUE_* override safe.
     */
    private function configureSupervisorTopology(): void
    {
        foreach ($this->app->make(QueueTopology::class)->horizonSupervisors() as $supervisor => $values) {
            config([
                "horizon.defaults.{$supervisor}.connection" => $values['connection'],
                "horizon.defaults.{$supervisor}.queue" => $values['queue'],
            ]);
        }
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
        // seconds in. Extend the record to cover the job before it starts, and
        // record what the job *is* while we are here -- that is what lets the
        // admin page say "busy 41m on Install modpack" instead of listing a PID.
        $this->app['events']->listen(JobProcessing::class, function (JobProcessing $event) {
            $this->app->make(QueueWorkerHeartbeat::class)->startJob(
                $event->job->resolveName(),
                $event->job->timeout(),
            );
        });

        // Both outcomes clear the job off the record. Without the failure case
        // a worker that threw would advertise that job until its next beat.
        $this->app['events']->listen(JobProcessed::class, function () {
            $this->app->make(QueueWorkerHeartbeat::class)->finishJob();
        });

        $this->app['events']->listen(JobFailed::class, function () {
            $this->app->make(QueueWorkerHeartbeat::class)->finishJob();
        });
    }

    /**
     * Record that cron is invoking the scheduler.
     *
     * Wired here, beside the queue heartbeat, because the two are reported
     * together: the admin queue page is the only place that can say a panel is
     * healthy, and it cannot say that from lane depth alone. If the cron entry
     * stops, every lane stays clear and every worker stays green while nothing
     * scheduled runs -- the queue is genuinely fine, it is just not being fed.
     *
     * `schedule:run` starting is the signal rather than a task finishing. A tick
     * where nothing was due still proves cron is alive, and most of this panel's
     * per-minute tasks sit behind module flags.
     *
     * Recording only. Nothing here can start, stop or trigger a scheduled task,
     * and the page that reads it has no endpoint that could.
     */
    private function registerSchedulerHeartbeat(): void
    {
        $this->app['events']->listen(CommandStarting::class, function (CommandStarting $event) {
            if ($event->command === 'schedule:run') {
                $this->app->make(SchedulerHeartbeat::class)->beat();
            }
        });

        // Which tasks actually ran. This is the only visibility the panel has
        // into scheduled work that does its job inline rather than dispatching
        // a job -- most of config/schedule, and none of it visible on a queue.
        $this->app['events']->listen(ScheduledTaskFinished::class, function (ScheduledTaskFinished $event) {
            $this->app->make(SchedulerHeartbeat::class)->recordFinished(
                $event->task->getSummaryForDisplay(),
                $event->runtime * 1000,
            );
        });

        $this->app['events']->listen(ScheduledTaskFailed::class, function (ScheduledTaskFailed $event) {
            $this->app->make(SchedulerHeartbeat::class)->recordFailed(
                $event->task->getSummaryForDisplay(),
                $event->exception->getMessage(),
            );
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
     * Staff the conditional supervisors only when their lane can receive work.
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
            $topology = $this->app->make(QueueTopology::class);

            config([
                'horizon.defaults.supervisor-mods.processes' => $topology->isExpected('mods') ? 1 : 0,

                // Agent turns are long and mostly blocked, so one process is one
                // concurrent turn. Sized against the inference concurrency the
                // gate already enforces rather than against CPU: staffing more
                // workers than there are inference slots only moves the queue
                // from Redis into the provider.
                'horizon.defaults.supervisor-agent.processes' => $topology->isExpected('agent')
                    ? $this->agentProcesses()
                    : 0,
            ]);
        });
    }

    /**
     * How many agent workers to run.
     *
     * `concurrency.slots` is nullable and means "derive it from the model
     * probe", which cannot be done here — a queue worker must not depend on the
     * inference backend being reachable at boot. When it is unset, one process
     * is the honest floor: turns still run, they just queue against each other
     * through the gate the same way they already do.
     */
    private function agentProcesses(): int
    {
        $slots = config('modules.ai.concurrency.slots');

        return is_numeric($slots) ? max(1, min(8, (int) $slots)) : 1;
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
