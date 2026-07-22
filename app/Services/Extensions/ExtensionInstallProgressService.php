<?php

namespace Everest\Services\Extensions;

use Illuminate\Support\Facades\File;

/**
 * Tracks the real-time installation/uninstallation progress of an extension
 * using a JSON file in storage so that the progress survives cache clears
 * (e.g. the `php artisan optimize:clear` step inside the rebuild pipeline).
 */
class ExtensionInstallProgressService
{
    private const PROGRESS_FILE = 'extensions/.progress.json';

    /**
     * Valid stage identifiers emitted during an install.
     */
    public const INSTALL_STAGES = [
        'downloading',
        'extracting',
        'validating',
        'copying',
        'migrating',
        'optimizing',
        'building',
        'registering',
        'completed',
    ];

    /**
     * Valid stage identifiers emitted during an uninstall.
     */
    public const UNINSTALL_STAGES = [
        'validating',
        'migrating',
        'removing',
        'optimizing',
        'building',
        'registering',
        'completed',
    ];

    /**
     * Valid stage identifiers emitted during a package update.
     */
    public const UPDATE_STAGES = [
        'downloading',
        'extracting',
        'validating',
        'removing',
        'copying',
        'migrating',
        'optimizing',
        'building',
        'registering',
        'completed',
    ];

    /**
     * Record the current stage of an in-progress operation.
     *
     * @param int|null $batchTotal total number of extensions in a batch (null for single operations)
     * @param int|null $batchCurrent 1-based index of the extension currently being processed in a batch
     * @param string[]|null $batchExtensions ordered list of all extension IDs in the batch
     *
     * @throws \InvalidArgumentException if $action or $stage is not recognised
     */
    public function report(string $action, string $extensionId, string $stage, ?int $batchTotal = null, ?int $batchCurrent = null, ?array $batchExtensions = null): void
    {
        $validStages = match ($action) {
            'install'         => self::INSTALL_STAGES,
            'uninstall'       => self::UNINSTALL_STAGES,
            'update'          => self::UPDATE_STAGES,
            'batch-install'   => self::INSTALL_STAGES,
            'batch-uninstall' => self::UNINSTALL_STAGES,
            'batch-update'    => self::UPDATE_STAGES,
            default           => throw new \InvalidArgumentException(sprintf('Unknown extension action "%s".', $action)),
        };

        if (!in_array($stage, $validStages, true)) {
            throw new \InvalidArgumentException(sprintf('Invalid stage "%s" for action "%s".', $stage, $action));
        }

        $path = $this->progressFilePath();
        $tmp  = $path . '.tmp';

        File::ensureDirectoryExists(dirname($path));

        // Carry forward started_at so callers can detect stale/hung operations.
        $existing = $this->current();
        $startedAt = $existing['started_at'] ?? now()->toIso8601String();

        $payload = [
            'action'       => $action,
            'extension_id' => $extensionId,
            'stage'        => $stage,
            'started_at'   => $startedAt,
            'updated_at'   => now()->toIso8601String(),
        ];

        if ($batchTotal !== null) {
            $payload['batch_total']      = $batchTotal;
            $payload['batch_current']    = $batchCurrent ?? 1;
            if ($batchExtensions !== null) {
                $payload['batch_extensions'] = $batchExtensions;
            }
        }

        // Atomic write: write to a temp file then rename into place so a
        // concurrent reader never sees partial JSON.
        File::put($tmp, json_encode($payload, JSON_UNESCAPED_SLASHES));

        rename($tmp, $path);
    }

    /**
     * Return the current progress payload or null when no operation is running.
     *
     * @return array<string, string>|null
     */
    public function current(): ?array
    {
        $path = $this->progressFilePath();

        if (!File::exists($path)) {
            return null;
        }

        $contents = File::get($path);
        $data = json_decode($contents, true);

        return is_array($data) ? $data : null;
    }

    /**
     * Clear the progress record (called after an operation finishes or fails).
     */
    public function clear(): void
    {
        File::delete($this->progressFilePath());
    }

    /**
     * Absolute path to the progress JSON file.
     */
    private function progressFilePath(): string
    {
        return storage_path('app/' . self::PROGRESS_FILE);
    }
}
