<?php

namespace Everest\Console;

use Everest\Models\ActivityLog;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\Console\PruneCommand;
use Everest\Console\Commands\Billing\CleanupOrdersCommand;
use Everest\Console\Commands\Billing\ExpireCouponsCommand;
use Everest\Console\Commands\Billing\ExpireInvoicesCommand;
use Everest\Console\Commands\Billing\ExpirePdfCacheCommand;
use Everest\Console\Commands\Auth\ProcessJGuardActivationsCommand;
use Everest\Console\Commands\Email\ProcessDeferredEmailsCommand;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use Everest\Console\Commands\Schedule\ProcessRunnableCommand;
use Everest\Console\Commands\Billing\SuspendBillableServersCommand;
use Everest\Console\Commands\Maintenance\PruneOrphanedBackupsCommand;
use Everest\Console\Commands\Billing\CalculateOrderThreatIndexCommand;
use Everest\Console\Commands\Billing\RefreshNodeAvailabilityCommand;
use Everest\Console\Commands\Maintenance\CleanServiceBackupFilesCommand;
use Everest\Console\Commands\Billing\DeleteScheduledServersCommand;
use Everest\Console\Commands\AI\PruneAiConversationsCommand;
use Everest\Console\Commands\AI\WarmAiModelCommand;

class Kernel extends ConsoleKernel
{
    /**
     * Register the commands for the application.
     */
    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');
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
            $schedule->command(CleanupOrdersCommand::class)->hourly();
            $schedule->command(SuspendBillableServersCommand::class)->daily();
            // Run near end of day so scheduled deletions occur after the full renewal date has passed.
            $schedule->command(DeleteScheduledServersCommand::class)->dailyAt('23:55');
            $schedule->command(CalculateOrderThreatIndexCommand::class)->everyFiveMinutes();
            $schedule->command(RefreshNodeAvailabilityCommand::class)->everyMinute()->withoutOverlapping();
            $schedule->command(ExpireCouponsCommand::class)->twiceDaily(1, 13);
            $schedule->command(ExpirePdfCacheCommand::class)->hourly();        // Evict local 24-h PDF cache
            $schedule->command(ExpireInvoicesCommand::class)->dailyAt('02:00'); // Auto-cleanup data snapshots (if enabled)
        }

        // Process deferred emails every 5 minutes
        $schedule->command(ProcessDeferredEmailsCommand::class)->everyFiveMinutes();

        // Process jGuard delayed activations every minute
        $schedule->command(ProcessJGuardActivationsCommand::class)->everyMinute();

        // Send server renewal notices (run daily - checks for servers expiring in 7, 3, and 1 day)
        if (config('modules.billing.enabled')) {
            $schedule->command('email:send-renewal-notices', ['--days' => 7])->dailyAt('09:00'); // 7 days notice
            $schedule->command('email:send-renewal-notices', ['--days' => 3])->dailyAt('09:15'); // 3 days notice
            $schedule->command('email:send-renewal-notices', ['--days' => 1])->dailyAt('09:30'); // 1 day notice
        }
    }
}
