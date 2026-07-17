<?php

namespace Everest\Services\Extensions;

use Everest\Models\ExtensionConfig;
use Illuminate\Console\Scheduling\Schedule;

/**
 * Registers scheduled tasks contributed by installed extension packages.
 *
 * Each package may ship an app/Extensions/Packages/<id>/schedule.php that
 * returns a closure receiving the Schedule. Files are only loaded for
 * extensions whose ExtensionConfig is enabled — a disabled extension never
 * even registers its entries. Extension commands are expected to early-exit
 * on disabled config as a second layer (they can be invoked manually).
 */
class ExtensionScheduleService
{
    public function register(Schedule $schedule): void
    {
        if (!config('modules.extensions.enabled')) {
            return;
        }

        try {
            $enabledIds = ExtensionConfig::query()
                ->where('enabled', true)
                ->pluck('extension_id')
                ->all();
        } catch (\Throwable) {
            // Fresh installs may run artisan before migrations exist; the
            // scheduler simply has no extension entries yet.
            return;
        }

        foreach ($enabledIds as $extensionId) {
            $file = app_path(sprintf('Extensions/Packages/%s/schedule.php', $extensionId));
            if (!is_file($file)) {
                continue;
            }

            // Parse errors surface as \Error, so \Throwable is required here:
            // one broken schedule.php must not take down cron for everything.
            try {
                $callback = require $file;
                if (is_callable($callback)) {
                    $callback($schedule);
                }
            } catch (\Throwable $exception) {
                report($exception);
            }
        }
    }
}
