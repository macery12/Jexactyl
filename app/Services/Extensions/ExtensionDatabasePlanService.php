<?php

namespace Everest\Services\Extensions;

use Everest\Exceptions\DisplayException;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

/**
 * Computes a read-only preview of the database changes an install, update, or
 * uninstall would make, so the admin UI can show "this will modify your
 * database — these tables will be added / dropped / preserved" BEFORE the
 * operation runs. Nothing here executes migrations or writes to the schema.
 *
 * - uninstall: cheap and local. The extension's files are on disk, so the
 *   owned tables (ext_<id>_ prefix) and ran migrations are read directly.
 * - install / update: the migration files aren't local yet, so the package
 *   archive is downloaded and extracted to a temp dir and its migration
 *   sources are parsed for Schema::create() table names. The temp dir is
 *   always cleaned up.
 */
class ExtensionDatabasePlanService
{
    public function __construct(
        private ExtensionCatalogService $catalogService,
        private ExtensionPackageArtifactService $artifactService,
        private ExtensionMigrationService $migrationService
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function plan(string $extensionId, string $operation, ?int $repositoryId = null, ?string $version = null): array
    {
        return match ($operation) {
            'uninstall' => $this->uninstallPlan($extensionId),
            'install' => $this->archivePlan($extensionId, 'install', (int) $repositoryId, $version),
            'update' => $this->archivePlan($extensionId, 'update', (int) $repositoryId, $version),
            default => throw new DisplayException('Unknown database-plan operation.'),
        };
    }

    /**
     * Uninstall preview from local state: what the extension owns right now.
     *
     * @return array<string, mixed>
     */
    private function uninstallPlan(string $extensionId): array
    {
        $existingTables = $this->migrationService->listExtensionTables($extensionId);
        $ranMigrations = $this->migrationService->ranMigrationNames($extensionId);

        return [
            'operation' => 'uninstall',
            'extensionId' => $extensionId,
            'tablePrefix' => $this->migrationService->tablePrefix($extensionId),
            'hasDatabase' => $existingTables !== [] || $ranMigrations !== [],
            'existingTables' => $existingTables,
            'ranMigrations' => $ranMigrations,
            'manualCleanup' => $existingTables === [] && $ranMigrations === []
                ? []
                : $this->migrationService->manualCleanupStatements($extensionId, $ranMigrations),
        ];
    }

    /**
     * Install / update preview by parsing the package archive's migrations.
     * For an update, only migrations not already recorded as ran are counted
     * (Laravel skips already-applied filenames), and the extension's current
     * tables are surfaced as unchanged.
     *
     * @return array<string, mixed>
     */
    private function archivePlan(string $extensionId, string $operation, int $repositoryId, ?string $version): array
    {
        $package = $this->catalogService->findRepositoryPackage($extensionId, $repositoryId, $version);
        $release = $package['latestRelease'];

        $tempRoot = storage_path('app/extensions/tmp-plan/' . Str::uuid()->toString());
        $archivePath = $tempRoot . '/' . ExtensionPackageArtifactService::PACKAGE_ARTIFACT_FILENAME;
        $extractPath = $tempRoot . '/extract';

        File::ensureDirectoryExists($extractPath);

        try {
            $this->artifactService->downloadArchive($release['archiveUrl'], $archivePath);
            if (!empty($release['archiveChecksum'])) {
                $this->artifactService->verifyChecksum($archivePath, $release['archiveChecksum'], 'archive');
            }
            $this->artifactService->extractArchive($archivePath, $extractPath);

            $migrationFiles = glob(sprintf(
                '%s/%s/*.php',
                $extractPath,
                $this->migrationService->migrationPath($extensionId)
            )) ?: [];

            $ranMigrations = $operation === 'update'
                ? $this->migrationService->ranMigrationNames($extensionId)
                : [];

            // For an update, only files the panel hasn't already run will execute.
            $pendingFiles = array_values(array_filter(
                $migrationFiles,
                fn (string $file) => !in_array(basename($file, '.php'), $ranMigrations, true)
            ));

            return [
                'operation' => $operation,
                'extensionId' => $extensionId,
                'tablePrefix' => $this->migrationService->tablePrefix($extensionId),
                'hasDatabase' => $pendingFiles !== [],
                'version' => $release['version'] ?? $version,
                'tablesToCreate' => $this->migrationService->parseCreatedTables($pendingFiles),
                'migrations' => array_map(fn (string $file) => basename($file, '.php'), $pendingFiles),
                'unchangedTables' => $operation === 'update'
                    ? $this->migrationService->listExtensionTables($extensionId)
                    : [],
            ];
        } catch (\Throwable $exception) {
            if ($exception instanceof DisplayException) {
                throw $exception;
            }

            throw new DisplayException('Failed to inspect the extension package\'s database changes.', $exception);
        } finally {
            File::deleteDirectory($tempRoot);
        }
    }
}
