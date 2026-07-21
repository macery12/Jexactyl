<?php

namespace Everest\Services\Extensions;

use Everest\Exceptions\DisplayException;
use Everest\Models\ExtensionPackage;

/**
 * Orchestrates batch install, uninstall, and update operations for multiple extensions.
 *
 * The key optimization is that file operations are performed for ALL extensions first,
 * and the panel is rebuilt ONLY ONCE after all file transfers are complete — instead of
 * rebuilding after each individual extension.
 *
 * Flow for each batch type:
 *   1. Prepare each extension (download / extract / copy / remove files).
 *   2. Rebuild the panel once.
 *   3. Finalize each extension (write / update / delete database records).
 */
class ExtensionPackageBatchService
{
    public function __construct(
        private ExtensionPackageInstallService $installService,
        private ExtensionPackageUninstallService $uninstallService,
        private ExtensionPackageUpdateService $updateService,
        private ExtensionPanelRebuildService $rebuildService,
        private ExtensionOperationLockService $operationLockService,
        private ExtensionFilesystemOwnershipService $ownershipService,
        private ExtensionInstallProgressService $progressService
    ) {
    }

    /**
     * Install multiple extensions, performing all file operations first and rebuilding
     * the panel only once after every extension's files have been copied into place.
     *
     * @param array<int, array{extensionId: string, repositoryId: int, version?: string|null}> $items
     * @return array<int, ExtensionPackage>
     */
    public function batchInstall(array $items): array
    {
        if ($items === []) {
            return [];
        }

        return $this->operationLockService->withinLock('install', 'batch', function () use ($items) {
            $preparedList = [];
            $total = count($items);
            $allExtensionIds = array_column($items, 'extensionId');

            try {
                foreach ($items as $index => $item) {
                    $current = $index + 1;
                    $this->progressService->report('batch-install', $item['extensionId'], 'downloading', $total, $current, $allExtensionIds);
                    $prepared = $this->installService->prepareInstall(
                        $item['extensionId'],
                        (int) $item['repositoryId'],
                        $item['version'] ?? null
                    );
                    $preparedList[] = $prepared;
                }

                // Rebuild the panel once for all prepared installs.
                $lastExtensionId = end($preparedList)['extensionId'] ?? 'unknown';
                $this->rebuildService->rebuild(
                    sprintf('Batch install %d extension(s)', $total),
                    function (int $cmdIndex) use ($lastExtensionId, $total, $allExtensionIds): void {
                        $this->progressService->report(
                            'batch-install',
                            $lastExtensionId,
                            $cmdIndex === 0 ? 'optimizing' : 'building',
                            $total,
                            $total,
                            $allExtensionIds
                        );
                    }
                );

                // Finalize all installs (DB registration) after the rebuild succeeded.
                $this->progressService->report('batch-install', $lastExtensionId, 'registering', $total, $total, $allExtensionIds);
                $packages = [];
                foreach ($preparedList as $prepared) {
                    $packages[] = $this->installService->finalizeInstall($prepared);
                }

                $this->progressService->report('batch-install', $lastExtensionId, 'completed', $total, $total, $allExtensionIds);

                return $packages;
            } catch (\Throwable $exception) {
                foreach ($preparedList as $prepared) {
                    $this->installService->rollbackInstall($prepared);
                }

                $this->attemptRollbackRebuild('batch-install');

                if ($exception instanceof DisplayException) {
                    throw $exception;
                }

                throw new DisplayException('Failed to complete the batch install.', $exception);
            } finally {
                $this->progressService->clear();
                foreach ($preparedList as $prepared) {
                    $this->ownershipService->repairStandardPaths($prepared['extensionId'] ?? null);
                    $this->installService->cleanupPreparedInstall($prepared);
                }
            }
        });
    }

    /**
     * Uninstall multiple extensions, performing all file removal first and rebuilding
     * the panel only once after every extension's files have been removed.
     *
     * Data is preserved by default. An extension may opt into the same audited
     * data drop the single uninstall performs by setting dropData => true on
     * its item; each such drop rolls the extension's migrations back (before
     * its files are removed) and writes its own migration log, so the audit
     * trail stays per-extension.
     *
     * @param array<int, array{extensionId: string, dropData?: bool}> $items
     * @return array<int, array{extensionId: string, dataDropped: bool, migrationLog: ?string}>
     */
    public function batchUninstall(array $items, ?string $initiator = null): array
    {
        if ($items === []) {
            return [];
        }

        return $this->operationLockService->withinLock('uninstall', 'batch', function () use ($items, $initiator) {
            $preparedList = [];
            $total = count($items);
            $allExtensionIds = array_column($items, 'extensionId');

            try {
                foreach ($items as $index => $item) {
                    $current = $index + 1;
                    $extensionId = $item['extensionId'];
                    $this->progressService->report('batch-uninstall', $extensionId, 'validating', $total, $current, $allExtensionIds);
                    $prepared = $this->uninstallService->prepareUninstall(
                        $extensionId,
                        (bool) ($item['dropData'] ?? false),
                        $initiator
                    );
                    $preparedList[] = $prepared;
                }

                // Rebuild the panel once for all prepared uninstalls.
                $lastExtensionId = end($preparedList)['extensionId'] ?? 'unknown';
                $this->rebuildService->rebuild(
                    sprintf('Batch uninstall %d extension(s)', $total),
                    function (int $cmdIndex) use ($lastExtensionId, $total, $allExtensionIds): void {
                        $this->progressService->report(
                            'batch-uninstall',
                            $lastExtensionId,
                            $cmdIndex === 0 ? 'optimizing' : 'building',
                            $total,
                            $total,
                            $allExtensionIds
                        );
                    }
                );

                // Finalize all uninstalls (DB deletion) after the rebuild succeeded.
                $this->progressService->report('batch-uninstall', $lastExtensionId, 'registering', $total, $total, $allExtensionIds);
                foreach ($preparedList as $prepared) {
                    $this->uninstallService->finalizeUninstall($prepared);
                }

                $this->progressService->report('batch-uninstall', $lastExtensionId, 'completed', $total, $total, $allExtensionIds);

                return array_map(fn (array $prepared) => [
                    'extensionId' => $prepared['extensionId'],
                    'dataDropped' => (bool) ($prepared['resetMigrations'] ?? false),
                    'migrationLog' => $prepared['migrationLog'] ?? null,
                ], $preparedList);
            } catch (\Throwable $exception) {
                foreach ($preparedList as $prepared) {
                    $this->uninstallService->rollbackUninstall($prepared);
                }

                $this->attemptRollbackRebuild('batch-uninstall');

                if ($exception instanceof DisplayException) {
                    throw $exception;
                }

                throw new DisplayException('Failed to complete the batch uninstall.', $exception);
            } finally {
                $this->progressService->clear();
                foreach ($preparedList as $prepared) {
                    $this->ownershipService->repairStandardPaths($prepared['extensionId'] ?? null);
                    $this->uninstallService->cleanupPreparedUninstall($prepared);
                }
            }
        });
    }

    /**
     * Update multiple extensions, performing all file operations first and rebuilding
     * the panel only once after every extension's files have been swapped into place.
     *
     * @param array<int, array{extensionId: string, repositoryId: int, version?: string|null}> $items
     * @return array<int, ExtensionPackage>
     */
    public function batchUpdate(array $items): array
    {
        if ($items === []) {
            return [];
        }

        return $this->operationLockService->withinLock('update', 'batch', function () use ($items) {
            $preparedList = [];
            $total = count($items);
            $allExtensionIds = array_column($items, 'extensionId');

            try {
                foreach ($items as $index => $item) {
                    $current = $index + 1;
                    $this->progressService->report('batch-update', $item['extensionId'], 'downloading', $total, $current, $allExtensionIds);
                    $prepared = $this->updateService->prepareUpdate(
                        $item['extensionId'],
                        (int) $item['repositoryId'],
                        $item['version'] ?? null
                    );
                    $preparedList[] = $prepared;
                }

                // Rebuild the panel once for all prepared updates.
                $lastExtensionId = end($preparedList)['extensionId'] ?? 'unknown';
                $this->rebuildService->rebuild(
                    sprintf('Batch update %d extension(s)', $total),
                    function (int $cmdIndex) use ($lastExtensionId, $total, $allExtensionIds): void {
                        $this->progressService->report(
                            'batch-update',
                            $lastExtensionId,
                            $cmdIndex === 0 ? 'optimizing' : 'building',
                            $total,
                            $total,
                            $allExtensionIds
                        );
                    }
                );

                // Finalize all updates (DB records) after the rebuild succeeded.
                $this->progressService->report('batch-update', $lastExtensionId, 'registering', $total, $total, $allExtensionIds);
                $packages = [];
                foreach ($preparedList as $prepared) {
                    $packages[] = $this->updateService->finalizeUpdate($prepared);
                }

                $this->progressService->report('batch-update', $lastExtensionId, 'completed', $total, $total, $allExtensionIds);

                return $packages;
            } catch (\Throwable $exception) {
                foreach ($preparedList as $prepared) {
                    $this->updateService->rollbackUpdate($prepared);
                }

                $this->attemptRollbackRebuild('batch-update');

                if ($exception instanceof DisplayException) {
                    throw $exception;
                }

                throw new DisplayException('Failed to complete the batch update.', $exception);
            } finally {
                $this->progressService->clear();
                foreach ($preparedList as $prepared) {
                    $this->ownershipService->repairStandardPaths($prepared['extensionId'] ?? null);
                    $this->updateService->cleanupPreparedUpdate($prepared);
                }
            }
        });
    }

    private function attemptRollbackRebuild(string $reason): void
    {
        try {
            $this->rebuildService->rebuild(sprintf('%s rollback', $reason));
        } catch (\Throwable $exception) {
            report($exception);
        }
    }
}
