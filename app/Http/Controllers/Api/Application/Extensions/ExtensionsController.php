<?php

namespace Everest\Http\Controllers\Api\Application\Extensions;

use Everest\Models\Nest;
use Everest\Models\Setting;
use Illuminate\Support\Str;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Models\ExtensionConfig;
use Everest\Models\ExtensionRepository;
use Everest\Services\Extensions\ExtensionCatalogService;
use Everest\Services\Extensions\ExtensionDatabasePlanService;
use Everest\Services\Extensions\ExtensionPackageBatchService;
use Everest\Traits\Controllers\RespondsWithExtensionEnvelope;
use Everest\Services\Extensions\ExtensionPackageUpdateService;
use Everest\Services\Extensions\ExtensionPackageInstallService;
use Everest\Services\Extensions\ExtensionInstallProgressService;
use Everest\Services\Extensions\ExtensionPackageUninstallService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Extensions\DatabasePlanRequest;
use Everest\Http\Requests\Api\Application\Extensions\GetExtensionsRequest;
use Everest\Http\Requests\Api\Application\Extensions\UpdateExtensionRequest;
use Everest\Http\Requests\Api\Application\Extensions\InstallExtensionRequest;
use Everest\Http\Requests\Api\Application\Extensions\UninstallExtensionRequest;
use Everest\Http\Requests\Api\Application\Extensions\BatchUpdateExtensionRequest;
use Everest\Http\Requests\Api\Application\Extensions\BatchInstallExtensionRequest;
use Everest\Http\Requests\Api\Application\Extensions\BatchUninstallExtensionRequest;
use Everest\Http\Requests\Api\Application\Extensions\UpdateExtensionSettingsRequest;
use Everest\Http\Requests\Api\Application\Extensions\StoreExtensionRepositoryRequest;
use Everest\Http\Requests\Api\Application\Extensions\UpdateExtensionRepositoryRequest;

class ExtensionsController extends ApplicationApiController
{
    use RespondsWithExtensionEnvelope;

    public function __construct(
        private ExtensionCatalogService $catalogService,
        private ExtensionPackageInstallService $installService,
        private ExtensionPackageUninstallService $uninstallService,
        private ExtensionPackageUpdateService $updateService,
        private ExtensionPackageBatchService $batchService,
        private ExtensionInstallProgressService $progressService,
        private ExtensionDatabasePlanService $databasePlanService,
    ) {
        parent::__construct();
    }

    /**
     * Preview the database changes an install, update, or uninstall would make
     * for a single extension — the tables it will add, drop, or preserve — so
     * the admin can review before committing. Read-only: runs no migrations.
     */
    public function databasePlan(DatabasePlanRequest $request, string $extensionId): JsonResponse
    {
        $plan = $this->databasePlanService->plan(
            $extensionId,
            $request->input('operation'),
            $request->filled('repository_id') ? (int) $request->input('repository_id') : null,
            $request->input('version')
        );

        return $this->extensionItemResponse('database_plan', $plan);
    }

    /**
     * Get all available extensions with their configurations.
     */
    public function index(GetExtensionsRequest $request): JsonResponse
    {
        return new JsonResponse([
            'object' => 'list',
            'data' => $this->catalogService->getCatalog()['extensions'],
        ]);
    }

    /**
     * Get all configured repositories and their current health.
     */
    public function repositories(GetExtensionsRequest $request): JsonResponse
    {
        return new JsonResponse([
            'object' => 'list',
            'data' => $this->catalogService->getRepositories(),
        ]);
    }

    /**
     * Force-refresh all repository manifests (bust cache) and return the updated extension list.
     */
    public function refresh(GetExtensionsRequest $request): JsonResponse
    {
        $catalog = $this->catalogService->getCatalog(forceRefresh: true);

        return new JsonResponse([
            'object' => 'list',
            'data' => $catalog['extensions'],
        ]);
    }

    /**
     * Get a single extension configuration.
     */
    public function view(GetExtensionsRequest $request, string $extensionId): JsonResponse
    {
        $extension = $this->catalogService->getExtension($extensionId);
        if (!$extension) {
            return new JsonResponse(['error' => 'Extension not found'], 404);
        }

        return new JsonResponse([
            'object' => 'extension',
            'attributes' => $extension,
        ]);
    }

    /**
     * Update an extension configuration.
     */
    public function update(UpdateExtensionRequest $request, string $extensionId): JsonResponse
    {
        $extension = $this->getManageableExtension($extensionId);
        if (!$extension) {
            return new JsonResponse(['error' => 'Extension not found'], 404);
        }

        $existing = ExtensionConfig::getByExtensionId($extensionId);

        $payload = [
            'allowed_nests' => $request->input('allowed_nests', []),
            'allowed_eggs' => $request->input('allowed_eggs', []),
            'settings' => $request->input('settings', []),
        ];

        if ($request->has('enabled')) {
            $payload['enabled'] = (bool) $request->input('enabled');
        } elseif ($existing) {
            $payload['enabled'] = (bool) $existing->enabled;
        }

        $config = ExtensionConfig::updateOrCreateConfig($extensionId, $payload);

        Activity::event('admin:extensions:update')
            ->property('extension_id', $extensionId)
            ->property('enabled', $config->enabled)
            ->log();

        $this->flushExtensionRouteCache();

        return new JsonResponse([
            'object' => 'extension',
            'attributes' => $this->catalogService->getExtension($extensionId, true),
        ]);
    }

    /**
     * Toggle an extension's enabled state.
     */
    public function toggle(UpdateExtensionRequest $request, string $extensionId): JsonResponse
    {
        $extension = $this->getManageableExtension($extensionId);
        if (!$extension) {
            return new JsonResponse(['error' => 'Extension not found'], 404);
        }

        $dbConfig = ExtensionConfig::getByExtensionId($extensionId);
        $newEnabled = $dbConfig ? !$dbConfig->enabled : true;

        $config = ExtensionConfig::updateOrCreateConfig($extensionId, [
            'enabled' => $newEnabled,
        ]);

        Activity::event('admin:extensions:toggle')
            ->property('extension_id', $extensionId)
            ->property('enabled', $config->enabled)
            ->log();

        $this->flushExtensionRouteCache();

        return new JsonResponse([
            'object' => 'extension',
            'attributes' => $this->catalogService->getExtension($extensionId, true),
        ]);
    }

    /**
     * Install a repository-backed extension package.
     */
    public function install(InstallExtensionRequest $request, string $extensionId): JsonResponse
    {
        $this->abortIfOperationRunning();

        $package = $this->installService->install(
            $extensionId,
            (int) $request->input('repository_id'),
            $request->input('version')
        );

        Activity::event('admin:extensions:install')
            ->property('extension_id', $extensionId)
            ->property('version', $package->installed_version)
            ->property('repository', $package->source_repository_name)
            ->log();

        $this->flushExtensionRouteCache();

        return new JsonResponse([
            'object' => 'extension',
            'attributes' => $this->catalogService->getExtension($extensionId, true),
        ], Response::HTTP_CREATED);
    }

    /**
     * Remove an installed repository-backed extension package.
     */
    public function uninstall(UninstallExtensionRequest $request, string $extensionId): JsonResponse
    {
        $this->abortIfOperationRunning();

        $dropData = $request->boolean('drop_data');
        if ($dropData && trim((string) $request->input('confirm')) !== $extensionId) {
            return new JsonResponse(['error' => 'Type the extension id in the confirmation field to drop its database tables.'], 422);
        }

        $result = $this->uninstallService->uninstall(
            $extensionId,
            $dropData,
            sprintf('admin:%s', $request->user()->email)
        );

        Activity::event('admin:extensions:uninstall')
            ->property('extension_id', $extensionId)
            ->property('drop_data', $dropData)
            ->log();

        if ($result['dataDropped']) {
            Activity::event('admin:extensions:data-drop')
                ->property('extension_id', $extensionId)
                ->property('migration_log', $result['migrationLog'])
                ->log();
        }

        $this->flushExtensionRouteCache();

        return new JsonResponse([
            'object' => 'extension',
            'attributes' => $this->catalogService->getExtension($extensionId, true) ?? [
                'id' => $extensionId,
                'installed' => false,
            ],
            'meta' => [
                'data_dropped' => $result['dataDropped'],
                'preserved_tables' => $result['preservedTables'],
                'manual_cleanup' => $result['manualCleanup'],
            ],
        ]);
    }

    /**
     * Invalidate a cached route table after a change to which extensions load.
     *
     * Extension routes are registered at boot from the enabled set
     * ({@see \Everest\Services\Extensions\ExtensionRuntimeGate}); a cached route
     * table (php artisan route:cache) would freeze that set, so enabling,
     * disabling, installing or removing an extension must clear it. This is a
     * no-op on the default configuration, which does not cache routes.
     */
    private function flushExtensionRouteCache(): void
    {
        if (app()->routesAreCached()) {
            \Illuminate\Support\Facades\Artisan::call('route:clear');
        }
    }

    /**
     * Update an already-installed repository-backed extension package to a newer version.
     */
    public function updatePackage(InstallExtensionRequest $request, string $extensionId): JsonResponse
    {
        $this->abortIfOperationRunning();

        $package = $this->updateService->update(
            $extensionId,
            (int) $request->input('repository_id'),
            $request->input('version')
        );

        Activity::event('admin:extensions:update-package')
            ->property('extension_id', $extensionId)
            ->property('version', $package->installed_version)
            ->property('repository', $package->source_repository_name)
            ->log();

        return new JsonResponse([
            'object' => 'extension',
            'attributes' => $this->catalogService->getExtension($extensionId, true),
        ]);
    }

    /**
     * Return the current install/uninstall/update progress stage for polling by the frontend.
     * Returns null when no operation is in progress.
     */
    public function progress(GetExtensionsRequest $request): JsonResponse
    {
        return new JsonResponse([
            'progress' => $this->progressService->current(),
        ]);
    }

    /**
     * Update the extensions module settings.
     */
    public function settings(UpdateExtensionSettingsRequest $request): Response
    {
        Setting::set('settings::modules:extensions:' . $request->input('key'), $request->input('value'));

        Activity::event('admin:extensions:settings')
            ->property('key', $request->input('key'))
            ->property('value', $request->input('value'))
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Add a new extension repository.
     */
    public function storeRepository(StoreExtensionRepositoryRequest $request): JsonResponse
    {
        if (ExtensionRepository::query()->where('manifest_url', trim($request->input('manifest_url')))->exists()) {
            return new JsonResponse(['error' => 'A repository with that manifest location already exists.'], 422);
        }

        $repository = ExtensionRepository::query()->create([
            'slug' => $this->generateRepositorySlug($request->input('name')),
            'name' => trim($request->input('name')),
            'manifest_url' => trim($request->input('manifest_url')),
            'homepage_url' => $request->filled('homepage_url') ? trim((string) $request->input('homepage_url')) : null,
            'enabled' => $request->boolean('enabled', true),
            'is_official' => false,
            'risk_acknowledged_at' => now(),
        ]);

        try {
            $this->catalogService->validateRepository($repository);
        } catch (\Throwable $exception) {
            $repository->delete();
            throw $exception;
        }

        Activity::event('admin:extensions:repository:create')
            ->property('repository', $repository->name)
            ->property('manifest_url', $repository->manifest_url)
            ->log();

        return new JsonResponse([
            'object' => 'extension_repository',
            'attributes' => $this->findRepositorySummary($repository->id),
        ], Response::HTTP_CREATED);
    }

    /**
     * Update an existing extension repository.
     */
    public function updateRepository(UpdateExtensionRepositoryRequest $request, ExtensionRepository $repository): JsonResponse
    {
        $previous = $repository->replicate();

        if ($request->filled('manifest_url')) {
            $duplicate = ExtensionRepository::query()
                ->where('id', '!=', $repository->id)
                ->where('manifest_url', trim((string) $request->input('manifest_url')))
                ->exists();

            if ($duplicate) {
                return new JsonResponse(['error' => 'A repository with that manifest location already exists.'], 422);
            }
        }

        $repository->fill([
            'name' => $request->filled('name') ? trim((string) $request->input('name')) : $repository->name,
            'manifest_url' => $request->filled('manifest_url') ? trim((string) $request->input('manifest_url')) : $repository->manifest_url,
            'homepage_url' => $request->exists('homepage_url')
                ? ($request->filled('homepage_url') ? trim((string) $request->input('homepage_url')) : null)
                : $repository->homepage_url,
        ]);

        if ($request->has('enabled')) {
            $repository->enabled = $request->boolean('enabled');
        }

        $repository->save();

        try {
            $this->catalogService->validateRepository($repository);
        } catch (\Throwable $exception) {
            $repository->forceFill($previous->getAttributes())->save();
            throw $exception;
        }

        Activity::event('admin:extensions:repository:update')
            ->property('repository', $repository->name)
            ->property('manifest_url', $repository->manifest_url)
            ->property('enabled', $repository->enabled)
            ->log();

        return new JsonResponse([
            'object' => 'extension_repository',
            'attributes' => $this->findRepositorySummary($repository->id),
        ]);
    }

    /**
     * Delete a custom extension repository.
     */
    public function deleteRepository(GetExtensionsRequest $request, ExtensionRepository $repository): Response|JsonResponse
    {
        if ($repository->is_official) {
            return new JsonResponse(['error' => 'The official M12Labs repository cannot be deleted. Disable it instead.'], 422);
        }

        $repositoryName = $repository->name;
        $repository->delete();

        Activity::event('admin:extensions:repository:delete')
            ->property('repository', $repositoryName)
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Get available nests and eggs for extension configuration.
     */
    public function getNestsAndEggs(GetExtensionsRequest $request): JsonResponse
    {
        $nests = Nest::with('eggs')->get();

        $nestsData = $nests->map(function ($nest) {
            return [
                'id' => $nest->id,
                'uuid' => $nest->uuid,
                'name' => $nest->name,
                'description' => $nest->description,
            ];
        });

        $eggsData = [];
        foreach ($nests as $nest) {
            foreach ($nest->eggs as $egg) {
                $eggsData[] = [
                    'id' => $egg->id,
                    'uuid' => $egg->uuid,
                    'name' => $egg->name,
                    'description' => $egg->description,
                    'nestId' => $nest->id,
                    'nestName' => $nest->name,
                ];
            }
        }

        return new JsonResponse([
            'nests' => $nestsData,
            'eggs' => $eggsData,
        ]);
    }

    /**
     * Install multiple extensions as a batch, performing all file operations first
     * and rebuilding the panel only once after all files are in place.
     */
    public function batchInstall(BatchInstallExtensionRequest $request): JsonResponse
    {
        $this->abortIfOperationRunning();
        $items = array_map(fn (array $item) => [
            'extensionId'  => $item['extension_id'],
            'repositoryId' => (int) $item['repository_id'],
            'version'      => $item['version'] ?? null,
        ], $request->input('extensions', []));

        $this->batchService->batchInstall($items);

        foreach ($items as $item) {
            Activity::event('admin:extensions:install')
                ->property('extension_id', $item['extensionId'])
                ->property('batch', true)
                ->log();
        }

        return new JsonResponse([
            'object' => 'list',
            'data'   => $this->catalogService->getCatalog()['extensions'],
        ], Response::HTTP_CREATED);
    }

    /**
     * Uninstall multiple extensions as a batch, removing all files first
     * and rebuilding the panel only once after all files are removed.
     */
    public function batchUninstall(BatchUninstallExtensionRequest $request): JsonResponse
    {
        $this->abortIfOperationRunning();
        $extensionIds = $request->input('extension_ids', []);

        // Map each opt-in data drop to its extension after verifying the typed
        // confirmation matches the id (mirrors the single-uninstall gate).
        $dropIds = [];
        foreach ($request->input('drop_data', []) as $entry) {
            $id = (string) ($entry['id'] ?? '');
            if (!in_array($id, $extensionIds, true)) {
                return new JsonResponse(['error' => sprintf('The extension "%s" flagged for a data drop is not part of this batch.', $id)], 422);
            }
            if (trim((string) ($entry['confirm'] ?? '')) !== $id) {
                return new JsonResponse(['error' => sprintf('Type the extension id "%s" in its confirmation field to drop its database tables.', $id)], 422);
            }
            $dropIds[$id] = true;
        }

        $items = array_map(fn (string $extensionId) => [
            'extensionId' => $extensionId,
            'dropData'    => isset($dropIds[$extensionId]),
        ], $extensionIds);

        $results = $this->batchService->batchUninstall(
            $items,
            sprintf('admin:%s', $request->user()->email)
        );

        foreach ($results as $result) {
            Activity::event('admin:extensions:uninstall')
                ->property('extension_id', $result['extensionId'])
                ->property('batch', true)
                ->property('drop_data', $result['dataDropped'])
                ->log();

            if ($result['dataDropped']) {
                Activity::event('admin:extensions:data-drop')
                    ->property('extension_id', $result['extensionId'])
                    ->property('migration_log', $result['migrationLog'])
                    ->property('batch', true)
                    ->log();
            }
        }

        return new JsonResponse([
            'object' => 'list',
            'data'   => $this->catalogService->getCatalog()['extensions'],
        ]);
    }

    /**
     * Update multiple extensions as a batch, performing all file operations first
     * and rebuilding the panel only once after all files are in place.
     */
    public function batchUpdate(BatchUpdateExtensionRequest $request): JsonResponse
    {
        $this->abortIfOperationRunning();
        $items = array_map(fn (array $item) => [
            'extensionId'  => $item['extension_id'],
            'repositoryId' => (int) $item['repository_id'],
            'version'      => $item['version'] ?? null,
        ], $request->input('extensions', []));

        $this->batchService->batchUpdate($items);

        foreach ($items as $item) {
            Activity::event('admin:extensions:update-package')
                ->property('extension_id', $item['extensionId'])
                ->property('batch', true)
                ->log();
        }

        return new JsonResponse([
            'object' => 'list',
            'data'   => $this->catalogService->getCatalog()['extensions'],
        ]);
    }

    private function getManageableExtension(string $extensionId): ?array
    {
        foreach ($this->catalogService->getLocalExtensions() as $extension) {
            if ($extension['id'] === $extensionId) {
                return $extension;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function findRepositorySummary(int $repositoryId): array
    {
        foreach ($this->catalogService->getRepositories(true) as $repository) {
            if ($repository['id'] === $repositoryId) {
                return $repository;
            }
        }

        return [
            'id' => $repositoryId,
        ];
    }

    private function generateRepositorySlug(string $name): string
    {
        $baseSlug = Str::slug($name);
        $slug = $baseSlug === '' ? 'repository' : $baseSlug;

        while (ExtensionRepository::query()->where('slug', $slug)->exists()) {
            $slug = sprintf('%s-%s', $baseSlug === '' ? 'repository' : $baseSlug, Str::lower(Str::random(4)));
        }

        return $slug;
    }

    /**
     * Abort with 409 Conflict if a progress file indicates an operation is already in progress.
     * This is a fast, file-based guard that runs before the cache lock is acquired.
     */
    private function abortIfOperationRunning(): void
    {
        $current = $this->progressService->current();

        if ($current !== null && ($current['stage'] ?? '') !== 'completed') {
            $action  = $current['action'] ?? 'unknown';
            $subject = $current['extension_id'] ?? '';

            abort(Response::HTTP_CONFLICT, sprintf(
                'Another extension operation (%s%s) is already running. Wait for it to finish before starting a new install, update, or uninstall.',
                $action,
                $subject !== '' ? ": {$subject}" : ''
            ));
        }
    }
}
