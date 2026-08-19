<?php

namespace Everest\Console;

use Everest\Models\ActivityLog;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\Console\PruneCommand;
use Everest\Console\Commands\AI\WarmAiModelCommand;
use Everest\Console\Commands\Billing\CleanupOrdersCommand;
use Everest\Console\Commands\Billing\ExpireCouponsCommand;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use Everest\Console\Commands\Billing\ExpireInvoicesCommand;
use Everest\Console\Commands\Billing\ExpirePdfCacheCommand;
use Everest\Console\Commands\AI\PruneAiConversationsCommand;
use Everest\Console\Commands\Schedule\ProcessRunnableCommand;
use Everest\Console\Commands\Email\ProcessDeferredEmailsCommand;
use Everest\Console\Commands\Auth\ProcessJGuardActivationsCommand;
use Everest\Console\Commands\Billing\DeleteScheduledServersCommand;
use Everest\Console\Commands\Billing\SuspendBillableServersCommand;
use Everest\Console\Commands\Billing\RefreshNodeAvailabilityCommand;
use Everest\Console\Commands\Maintenance\PruneOrphanedBackupsCommand;
use Everest\Console\Commands\Billing\ApplyScheduledPlanChangesCommand;
use Everest\Console\Commands\Billing\CalculateOrderThreatIndexCommand;
use Everest\Console\Commands\Maintenance\CleanServiceBackupFilesCommand;

class Kernel extends ConsoleKernel
{
    /**
     * Register the commands for the application.
     */
    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');

        // Extension-contributed artisan commands. The glob is deliberately
        // scoped to Console/Commands directories: a wholesale load() over
        // Extensions/Packages would autoload-include route/schedule files and
        // execute their top-level Route:: calls at command registration time.
        //
        // Only enabled extensions are loaded, so a disabled extension's command
        // classes are never registered — they do not appear in artisan and
        // cannot be invoked at all until the extension is re-enabled.
        $enabledExtensionIds = \Everest\Services\Extensions\ExtensionRuntimeGate::enabledExtensionIds();
        foreach ((glob(app_path('Extensions/Packages/*/Console/Commands')) ?: []) as $extensionCommandDir) {
            $extensionId = basename(dirname(dirname($extensionCommandDir)));
            if (!in_array($extensionId, $enabledExtensionIds, true)) {
                continue;
            }

            $this->load($extensionCommandDir);
        }
    }

    /**
     * Define the application's command schedule.
     */
    protected function schedule(Schedule $schedule): void
    {
        // https://laravel.com/docs/10.x/upgrade#redis-cache-tags
        $schedule->command('cache:prune-stale-tags')->hourly();

        // Execute scheduled commands for servers every minute, as if there was a normal cron running.
        $schedule->command(ProcessRunnableCommand::class)->everyMinute()->withoutOverlapping();
        $schedule->command(CleanServiceBackupFilesCommand::class)->daily();
        $schedule->command(PruneAiConversationsCommand::class)->daily();
        // Re-assert Ollama keep_alive before it lapses; the command exits
        // immediately unless AI is enabled with warm-up on and mode=ollama.
        $schedule->command(WarmAiModelCommand::class)->everyFiveMinutes()->withoutOverlapping();

        if (config('backups.prune_age')) {
            // Every 30 minutes, run the backup pruning command so that any abandoned backups can be deleted.
            $schedule->command(PruneOrphanedBackupsCommand::class)->everyThirtyMinutes();
        }

        if (config('activity.prune_days')) {
            $schedule->command(PruneCommand::class, ['--model' => [ActivityLog::class]])->daily();
        }

        if (config('modules.billing.enabled')) {
            $schedule->command(CleanupOrdersCommand::class)->hourly()->withoutOverlapping();
            $schedule->command(SuspendBillableServersCommand::class)->daily();
            // Run near end of day so scheduled deletions occur after the full renewal date has passed.
            $schedule->command(DeleteScheduledServersCommand::class)->dailyAt('23:55');
            $schedule->command(CalculateOrderThreatIndexCommand::class)->everyFiveMinutes();
            $schedule->command(RefreshNodeAvailabilityCommand::class)->everyMinute()->withoutOverlapping();
            $schedule->command(ApplyScheduledPlanChangesCommand::class)->everyMinute()->withoutOverlapping();
            $schedule->command(ExpireCouponsCommand::class)->twiceDaily(1, 13);
            $schedule->command(ExpirePdfCacheCommand::class)->hourly();        // Evict local 24-h PDF cache
            $schedule->command(ExpireInvoicesCommand::class)->dailyAt('02:00'); // Auto-cleanup data snapshots (if enabled)
        }

        // Process deferred emails every 5 minutes. Overlap protection matters
        // here: without it, a slow run still holding its rows was joined by the
        // next tick and both dispatched the same emails.
        $schedule->command(ProcessDeferredEmailsCommand::class)->everyFiveMinutes()->withoutOverlapping();

        // Process jGuard delayed activations every minute
        $schedule->command(ProcessJGuardActivationsCommand::class)->everyMinute()->withoutOverlapping();

        // failed_jobs is append-only and had nothing pruning it. A week is long
        // enough to investigate a failure and short enough that the table stays
        // small — which is also why it needs no extra index.
        $schedule->command('queue:prune-failed', ['--hours' => 168])->weekly();

        // Rolls the live throughput/runtime counters into a retained time series.
        // Note this *deletes* the live counters as it goes, which is why the
        // queue page reports over the retained window rather than the counters.
        $schedule->command('horizon:snapshot')->everyFiveMinutes();

        // Send server renewal notices (run daily - checks for servers expiring in 7, 3, and 1 day)
        if (config('modules.billing.enabled')) {
            $schedule->command('email:send-renewal-notices', ['--days' => 7])->dailyAt('09:00'); // 7 days notice
            $schedule->command('email:send-renewal-notices', ['--days' => 3])->dailyAt('09:15'); // 3 days notice
            $schedule->command('email:send-renewal-notices', ['--days' => 1])->dailyAt('09:30'); // 1 day notice
        }

        // Scheduled tasks contributed by enabled extension packages.
        $this->app->make(\Everest\Services\Extensions\ExtensionScheduleService::class)->register($schedule);
    }
}
