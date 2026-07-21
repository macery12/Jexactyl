<?php

namespace Everest\Services\Extensions;

use Illuminate\Console\Scheduling\Schedule;

/**
 * Registers scheduled tasks contributed by installed extension packages.
 *
 * Each package may ship an app/Extensions/Packages/<id>/schedule.php that
 * returns a closure receiving the Schedule. Files are only loaded for
 * extensions the {@see ExtensionRuntimeGate} reports as enabled — a disabled
 * extension never even registers its entries. Because a disabled extension's
 * commands are also unregistered, there is nothing left for its schedule to
 * reference either.
 */
class ExtensionScheduleService
{
    public function register(Schedule $schedule): void
    {
        foreach (ExtensionRuntimeGate::enabledExtensionIds() as $extensionId) {
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
