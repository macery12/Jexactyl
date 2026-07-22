<?php

namespace Everest\Services\Extensions;

use Illuminate\Support\Facades\File;
use Everest\Exceptions\DisplayException;
use Everest\Models\ExtensionPackageFile;

/**
 * Shared file-level helpers used by the install, update and uninstall services:
 *   – validate that tracked files haven't been modified since installation
 *   – snapshot a set of files to a temporary directory
 *   – restore a set of files from a snapshot
 */
class ExtensionPackageFileService
{
    public function __construct(
        private ExtensionFilesystemOwnershipService $ownershipService,
    ) {
    }

    /**
     * Throw if any tracked file has been externally modified since installation.
     *
     * @param array<int, ExtensionPackageFile> $files
     * @param string $verb Human-readable operation verb for the error message (e.g. 'uninstalled', 'updated').
     */
    public function assertFilesUnmodified(array $files, string $verb): void
    {
        $modified = [];

        foreach ($files as $file) {
            $targetPath = base_path($file->path);
            if (!is_file($targetPath)) {
                $modified[] = $file->path;
                continue;
            }

            if (hash_file('sha256', $targetPath) !== $file->installed_checksum) {
                $modified[] = $file->path;
            }
        }

        if ($modified === []) {
            return;
        }

        $preview = implode(', ', array_slice($modified, 0, 5));
        $suffix = count($modified) > 5 ? ', and more' : '';

        throw new DisplayException(sprintf('The extension cannot be %s because these files were modified after installation: %s%s.', $verb, $preview, $suffix));
    }

    /**
     * Copy all currently-present tracked files into $rollbackRoot, preserving relative paths.
     *
     * @param array<int, ExtensionPackageFile> $files
     */
    public function createRollbackSnapshot(array $files, string $rollbackRoot): void
    {
        foreach ($files as $file) {
            $targetPath = base_path($file->path);
            if (!is_file($targetPath)) {
                continue;
            }

            $rollbackPath = $rollbackRoot . '/' . $file->path;
            File::ensureDirectoryExists(dirname($rollbackPath));
            File::copy($targetPath, $rollbackPath);
        }
    }

    /**
     * Restore tracked files from a snapshot directory created by createRollbackSnapshot().
     *
     * @param array<int, ExtensionPackageFile> $files
     */
    public function restoreRollbackSnapshot(array $files, string $rollbackRoot): void
    {
        foreach ($files as $file) {
            $rollbackPath = $rollbackRoot . '/' . $file->path;
            if (!is_file($rollbackPath)) {
                continue;
            }

            $targetPath = base_path($file->path);
            $this->ownershipService->ensureWritablePath($targetPath, $file->path);
            File::ensureDirectoryExists(dirname($targetPath));
            File::copy($rollbackPath, $targetPath);
        }
    }
}
