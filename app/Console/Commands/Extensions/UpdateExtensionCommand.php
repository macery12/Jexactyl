<?php

namespace Everest\Console\Commands\Extensions;

use Illuminate\Console\Command;
use Everest\Models\ExtensionRepository;
use Everest\Services\Extensions\ExtensionPackageUpdateService;
use Everest\Services\Extensions\ExtensionFilesystemOwnershipService;
use Everest\Console\Commands\Extensions\Concerns\HandlesExtensionPackages;
use Everest\Console\Commands\Extensions\Concerns\InteractsWithExtensionRepositories;

class UpdateExtensionCommand extends Command
{
    use HandlesExtensionPackages;
    use InteractsWithExtensionRepositories;

    protected $signature = 'p:extensions:update
                            {source? : Extension id from a configured repository, or a local package file path}
                            {--path= : Explicit path to a local .M12LabsExtension file}
                            {--repository= : Repository slug or numeric id for repository updates}
                            {--release= : Specific repository version to update to}
                            {--file : Prefer local package-file update mode}
                            {--label= : Stored source label for manual file updates}
                            {--yes : Skip interactive prompts when possible}
                            {--debug : Show detailed update diagnostics}';

    protected $description = 'Update an installed M12Labs extension from a repository entry or a local package file.';

    public function __construct(
        private ExtensionPackageUpdateService $updateService,
        private ExtensionFilesystemOwnershipService $ownershipService,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $source = trim((string) ($this->argument('source') ?? ''));
        $resolution = ['extensionId' => null];

        try {
            $resolution = $this->resolveResolution($source, 'update');

            if ($this->isDebug()) {
                $this->renderDebugResolution($resolution);
            }

            if ($resolution['mode'] === 'file') {
                $package = $this->updateService->updateFromArchive(
                    $resolution['archivePath'],
                    $resolution['label'],
                );
            } else {
                /** @var ExtensionRepository $repository */
                $repository = $resolution['repository'];
                $package = $this->updateService->update(
                    $resolution['extensionId'],
                    $repository->id,
                    $resolution['release'],
                );
            }
        } catch (\Throwable $exception) {
            $this->components->error($exception->getMessage());

            if ($this->isDebug()) {
                $this->renderDebugException($exception);
            }

            return self::FAILURE;
        } finally {
            $ownershipReport = $this->ownershipService->repairStandardPaths($resolution['extensionId'] ?? null);
            if ($ownershipReport !== [] && ($this->isDebug() || $this->ownershipService->isRunningAsRoot())) {
                $this->renderOwnershipReport($ownershipReport);
            }
        }

        $this->components->info(sprintf('Updated %s to %s.', $package->extension_id, $package->installed_version));
        $this->table(['Field', 'Value'], [
            ['Extension', $package->extension_id],
            ['Version', $package->installed_version],
            ['Source', $package->source_repository_name ?? 'Repository'],
            ['Archive', $package->source_archive_url ?? 'n/a'],
            ['Files', (string) $package->files->count()],
        ]);

        return self::SUCCESS;
    }
}
