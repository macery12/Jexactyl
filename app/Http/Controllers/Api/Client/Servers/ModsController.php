<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Everest\Services\Mods\ModrinthService;
use Everest\Services\Mods\SpigetService;
use Everest\Services\Plugins\ProviderAccessService;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Extensions\Packages\minecraft_startup_editor\MinecraftStartupOptions;
use Everest\Services\Plugins\PluginInstallService;
use Everest\Exceptions\Service\Mods\ModsServiceException;
use Everest\Jobs\DownloadModJob;
use Everest\Models\DownloadQueue;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Servers\Mods\GetModRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\SearchModsRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\DownloadModRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\GetModFilesRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\GetMinecraftVersionsRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\ToggleInstalledAddonRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\GetInstalledAddonsRequest;

class ModsController extends ClientApiController
{
    /**
     * Directories to skip when scanning for installed addons.
     * These contain internal/remapped files that are not real user plugins.
     */
    private const IGNORED_DIRECTORIES = [
        '.paper-remapped',
        '.paper-remapped-cp',
    ];

    /**
     * Cache TTL for installed addons scan (in seconds).
     */
    private const INSTALLED_CACHE_TTL = 300;

    /**
     * ModsController constructor.
     */
    public function __construct(
        private ModrinthService $modrinthService,
        private SpigetService $spigetService,
        private PluginInstallService $pluginInstallService,
        private DaemonFileRepository $fileRepository,
        private ProviderAccessService $providerAccessService
    ) {
        parent::__construct();
    }

    /**
     * Get the mod service based on the request source parameter.
     */
    private function getModService(string $source = null): ModrinthService|SpigetService
    {
        $source = $source ?? Setting::get('settings::modules:mods:default_source', config('modules.mods.default_source', 'modrinth'));

        if (in_array($source, ['spiget', 'spigot'], true)) {
            return $this->spigetService;
        }

        return $this->modrinthService;
    }

    /**
     * Determine provider key based on source and resource.
     */
    private function resolveProviderKey(?string $source, string $resource = 'mods'): string
    {
        if (in_array($source, ['spiget', 'spigot'], true)) {
            return 'spigot.plugins';
        }

        if ($source === 'modrinth') {
            return $resource === 'plugins' ? 'modrinth.plugins' : 'modrinth.mods';
        }

        return $resource === 'plugins' ? 'modrinth.plugins' : 'modrinth.mods';
    }

    private function denyResponse(): JsonResponse
    {
        return response()->json([
            'error' => 'Provider disabled',
            'reason' => "This provider is not enabled for this server (egg/nest policy).",
        ], 403);
    }

    private function checkProviderAllowed(Server $server, ?string $source, string $resource = 'mods'): ?JsonResponse
    {
        $providerKey = $this->resolveProviderKey($source, $resource);

        if (!$this->providerAccessService->isProviderAllowed($providerKey, $server->nest_id, $server->egg_id)) {
            return $this->denyResponse();
        }

        return null;
    }

    public function providerAccess(GetModRequest $request, Server $server): JsonResponse
    {
        $providers = [
            'modrinth.mods',
            'modrinth.plugins',
            'spigot.plugins',
        ];

        $result = [];
        foreach ($providers as $providerKey) {
            $result[$providerKey] = [
                'allowed' => $this->providerAccessService->isProviderAllowed($providerKey, $server->nest_id, $server->egg_id),
                'reason' => "Disabled by administrator for this server's egg/nest.",
            ];
        }

        return response()->json([
            'providers' => $result,
        ]);
    }

    public function serverConfig(GetModRequest $request, Server $server): JsonResponse
    {
        $cacheKey = "server:{$server->uuid}:server_config";

        $result = Cache::remember($cacheKey, 60, function () use ($server) {
            $versionVarNames = ['MINECRAFT_VERSION', 'MC_VERSION', 'VANILLA_VERSION'];
            $detectedVersion = null;
            foreach ($server->variables as $variable) {
                if (in_array($variable->env_variable, $versionVarNames, true) && !empty($variable->server_value)) {
                    $detectedVersion = $variable->server_value;
                    break;
                }
            }

            $loaderName = MinecraftStartupOptions::detectLoader($server->egg->name ?? '');

            $pluginPlatforms = ['paper', 'spigot', 'bukkit', 'folia', 'purpur', 'velocity', 'waterfall', 'bungeecord', 'sponge'];

            $detectedLoader   = null;
            $detectedPlatform = null;

            if ($loaderName !== null) {
                if (in_array($loaderName, $pluginPlatforms, true)) {
                    $detectedPlatform = $loaderName;
                } else {
                    $loaderIdMap = [
                        'forge'    => ['id' => 1, 'name' => 'Forge',    'slug' => 'forge'],
                        'neoforge' => ['id' => 6, 'name' => 'NeoForge', 'slug' => 'neoforge'],
                        'fabric'   => ['id' => 4, 'name' => 'Fabric',   'slug' => 'fabric'],
                        'quilt'    => ['id' => 5, 'name' => 'Quilt',    'slug' => 'quilt'],
                    ];
                    $detectedLoader = $loaderIdMap[$loaderName] ?? null;
                }
            }

            return [
                'detectedVersion'  => $detectedVersion,
                'detectedLoader'   => $detectedLoader,
                'detectedPlatform' => $detectedPlatform,
            ];
        });

        return response()->json($result);
    }

    public function installed(GetInstalledAddonsRequest $request, Server $server): JsonResponse
    {
        $type = $request->input('type') === 'plugins' ? 'plugins' : 'mods';
        $status = $request->input('status', 'all');
        $search = trim((string) $request->input('search', ''));
        $perPage = (int) $request->input('perPage', 50);
        $page = (int) $request->input('page', 1);

        $cacheKey = "server:{$server->uuid}:installed:{$type}";
        $items = Cache::remember($cacheKey, self::INSTALLED_CACHE_TTL, function () use ($server, $type) {
            return $this->scanJarDirectory(
                $server,
                $type === 'plugins' ? '/plugins' : '/mods',
                $type === 'plugins' ? 'plugin' : 'mod'
            );
        });

        $filtered = array_values(array_filter($items, function (array $item) use ($status, $search) {
            if ($status === 'enabled' && !$item['enabled']) {
                return false;
            }

            if ($status === 'disabled' && $item['enabled']) {
                return false;
            }

            if ($search !== '') {
                $needle = Str::lower($search);

                return Str::contains(Str::lower($item['friendly_name']), $needle)
                    || Str::contains(Str::lower($item['filename']), $needle);
            }

            return true;
        }));

        $filtered = $this->sortInstalledAddons($filtered);

        $paginator = $this->paginateInstalled($filtered, $perPage, $page);

        return response()->json([
            'items' => $paginator->items(),
            'pagination' => [
                'total' => $paginator->total(),
                'count' => $paginator->count(),
                'per_page' => $paginator->perPage(),
                'current_page' => $paginator->currentPage(),
                'total_pages' => $paginator->lastPage(),
            ],
        ]);
    }

    public function toggleInstalledAddon(ToggleInstalledAddonRequest $request, Server $server): JsonResponse
    {
        $type = $request->input('type') === 'plugins' ? 'plugins' : 'mods';
        $basePath = $type === 'plugins' ? '/plugins' : '/mods';
        $rawPath = $request->input('path');
        $normalizedPath = $this->normalizePath($request->input('path'));
        $enable = (bool) $request->boolean('enable');

        if (!Str::startsWith($normalizedPath, $basePath) || str_contains($normalizedPath, '..') || str_contains($rawPath, '..') || str_contains($rawPath, '%2e')) {
            return response()->json(['error' => 'Invalid path for this content type.'], 422);
        }

        $root = $this->normalizePath(dirname($normalizedPath));
        if ($root !== $basePath && !Str::startsWith($root, $basePath . '/')) {
            return response()->json(['error' => 'Invalid directory for this content type.'], 422);
        }
        $from = basename($normalizedPath);
        $target = $this->targetNameForState($from, $enable);

        // If already in desired state, just return the current data.
        if ($target !== $from) {
            $this->fileRepository->setServer($server)->renameFiles($root, [['from' => $from, 'to' => $target]]);
        }

        // Invalidate cache after toggle.
        $this->invalidateInstalledCache($server, $type);

        $items = $this->scanJarDirectory($server, $basePath, $type === 'plugins' ? 'plugin' : 'mod');
        $updatedPath = $this->joinPath($root, $target);
        $updated = collect($items)->firstWhere('path', $updatedPath);
        if (!$updated) {
            $updated = [
                'filename' => $target,
                'friendly_name' => $this->makeFriendlyName($target),
                'path' => $updatedPath,
                'size_bytes' => 0,
                'modified_at' => null,
                'type' => $type === 'plugins' ? 'plugin' : 'mod',
                'enabled' => $enable,
            ];
        }

        return response()->json([
            'item' => $updated,
        ]);
    }

    /**
     * Search for mods in the selected database.
     *
     * @throws ModsServiceException
     */
    public function search(SearchModsRequest $request, Server $server): JsonResponse
    {
        $resource = $request->input('resource', 'mods') === 'plugins' ? 'plugins' : 'mods';

        if ($response = $this->checkProviderAllowed($server, $request->input('source'), $resource)) {
            return $response;
        }

        $source = $request->input('source');
        $modService = $this->getModService($source);

        $params = array_filter([
            'searchFilter' => $request->input('searchFilter'),
            'sortField' => $request->input('sortField'),
            'sortOrder' => $request->input('sortOrder'),
            'gameVersion' => $request->input('gameVersion'),
            'modLoaderType' => $request->input('modLoaderType'),
            'pageSize' => $request->input('pageSize', 20),
            'index' => $request->input('index', 0),
            'categoryId' => $request->input('categoryId'),
            'minRating' => $request->input('minRating'),
            'platform' => $request->input('platform'),
            'resource' => $resource,
        ], function ($value) {
            return $value !== null;
        });

        try {
            $result = $modService->searchMods($params);

            return response()->json($result);
        } catch (ModsServiceException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get details of a specific mod.
     *
     * @throws ModsServiceException
     */
    public function getMod(GetModRequest $request, Server $server, string $modId): JsonResponse
    {
        $resource = $request->input('resource', 'mods') === 'plugins' ? 'plugins' : 'mods';

        if ($response = $this->checkProviderAllowed($server, $request->input('source'), $resource)) {
            return $response;
        }

        $source = $request->input('source');
        $modService = $this->getModService($source);

        try {
            $result = $modService->getMod($modId);

            return response()->json($result);
        } catch (ModsServiceException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get files for a specific mod.
     *
     * @throws ModsServiceException
     */
    public function getModFiles(GetModFilesRequest $request, Server $server, string $modId): JsonResponse
    {
        $resource = $request->input('resource', 'mods') === 'plugins' ? 'plugins' : 'mods';

        if ($response = $this->checkProviderAllowed($server, $request->input('source'), $resource)) {
            return $response;
        }

        $source = $request->input('source');
        $modService = $this->getModService($source);

        $params = array_filter([
            'gameVersion' => $request->input('gameVersion'),
            'modLoaderType' => $request->input('modLoaderType'),
            'pageSize' => $request->input('pageSize', 20),
            'index' => $request->input('index', 0),
            'resource' => $resource,
            'platform' => $request->input('platform'),
        ], function ($value) {
            return $value !== null;
        });

        try {
            $result = $modService->getModFiles($modId, $params);

            return response()->json($result);
        } catch (ModsServiceException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Queue a mod/plugin/modpack download for background processing.
     */
    public function downloadMod(DownloadModRequest $request, Server $server, string $modId, string $fileId): JsonResponse
    {
        $resource = $request->input('resource', 'mods') === 'plugins' ? 'plugins' : 'mods';

        if ($response = $this->checkProviderAllowed($server, $request->input('source'), $resource)) {
            return $response;
        }

        $source = $request->input('source') ?? Setting::get('settings::modules:mods:default_source', config('modules.mods.default_source', 'modrinth'));
        $type   = $resource === 'plugins' || in_array($source, ['spiget', 'spigot'], true) ? 'plugin' : 'mod';

        // Enforce per-user per-minute submission rate.
        $maxPerMinute   = (int) Setting::get('settings::modules:mods:download_max_per_minute', config('modules.mods.download.max_per_minute_per_user', 10));
        $userRateKey    = 'download_queue_rate:' . $server->uuid . ':' . auth()->id();
        $userSubmissions = Cache::get($userRateKey, 0);

        if ($userSubmissions >= $maxPerMinute) {
            return response()->json([
                'error' => "You can only queue {$maxPerMinute} downloads per minute. Please wait before adding more.",
            ], 429);
        }

        // Enforce per-server queue size cap.
        $maxQueueSize = (int) Setting::get('settings::modules:mods:download_max_queue_size', config('modules.mods.download.max_queue_size_per_server', 20));
        $activeCount  = DownloadQueue::where('server_id', $server->id)
            ->whereNotIn('status', DownloadQueue::TERMINAL_STATUSES)
            ->count();

        if ($activeCount >= $maxQueueSize) {
            return response()->json([
                'error' => "The download queue is full ({$maxQueueSize} items). Wait for current downloads to finish.",
            ], 429);
        }

        $queueItem = DownloadQueue::create([
            'uuid'       => Str::uuid()->toString(),
            'server_id'  => $server->id,
            'user_id'    => auth()->id(),
            'provider'   => $source,
            'source'     => $type,
            'project_id' => $modId,
            'file_id'    => $fileId,
            'status'     => DownloadQueue::STATUS_PENDING,
        ]);

        dispatch(new DownloadModJob($queueItem));

        // Increment the per-user rate counter.
        Cache::put($userRateKey, $userSubmissions + 1, 60);

        $position = DownloadQueue::where('server_id', $server->id)
            ->where('status', DownloadQueue::STATUS_PENDING)
            ->where('id', '<=', $queueItem->id)
            ->count();

        return response()->json([
            'queued'    => true,
            'queue_id'  => $queueItem->uuid,
            'position'  => $position,
        ], 202);
    }

    /**
     * Get available Minecraft versions.
     *
     * @throws ModsServiceException
     */
    public function getMinecraftVersions(GetMinecraftVersionsRequest $request, Server $server): JsonResponse
    {
        $resource = $request->input('resource', 'mods') === 'plugins' ? 'plugins' : 'mods';

        if ($response = $this->checkProviderAllowed($server, $request->input('source'), $resource)) {
            return $response;
        }

        $source = $request->input('source');
        $modService = $this->getModService($source);

        try {
            $result = $modService->getMinecraftVersions();

            return response()->json($result);
        } catch (ModsServiceException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Get available mod loader types.
     *
     * @throws ModsServiceException
     */
    public function getModLoaderTypes(GetMinecraftVersionsRequest $request, Server $server): JsonResponse
    {
        $resource = $request->input('resource', 'mods') === 'plugins' ? 'plugins' : 'mods';

        if ($response = $this->checkProviderAllowed($server, $request->input('source'), $resource)) {
            return $response;
        }

        $source = $request->input('source');
        $modService = $this->getModService($source);

        try {
            $result = $modService->getModLoaderTypes();

            return response()->json($result);
        } catch (ModsServiceException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Recursively scan a directory for jar-based addons (mods/plugins) while respecting
     * symlinks and missing directories.
     */
    private function scanJarDirectory(Server $server, string $path, string $type): array
    {
        $results = [];
        $normalized = $this->normalizePath($path);
        $entries = $this->listDirectorySafely($server, $normalized);

        if ($entries === null) {
            return $results;
        }

        foreach ($entries as $entry) {
            $name = Arr::get($entry, 'name');
            if (!$name || $name === '.' || $name === '..') {
                continue;
            }

            $isFile = (bool) Arr::get($entry, 'file', true);

            if ($isFile && $this->isJarLike($name)) {
                $fullPath = $this->joinPath($normalized, $name);
                $friendlyName = $this->makeFriendlyName($name);
                $isEnabled = !$this->isDisabledFile($name);
                $results[] = [
                    'filename' => $name,
                    'friendly_name' => $friendlyName,
                    'path' => $fullPath,
                    'size_bytes' => (int) Arr::get($entry, 'size', 0),
                    'modified_at' => $this->formatTimestamp(Arr::get($entry, 'modified')),
                    'type' => $type,
                    'enabled' => $isEnabled,
                    // Legacy keys for backward compatibility (can be removed once frontend is migrated)
                    'name' => $name,
                    'display_name' => $this->stripDisabledSuffix($name),
                    'size' => (int) Arr::get($entry, 'size', 0),
                    'disabled' => !$isEnabled,
                ];
            }
        }

        return $results;
    }

    private function paginateInstalled(array $items, int $perPage, int $page): LengthAwarePaginator
    {
        $perPage = $perPage > 0 ? $perPage : 50;
        $page = $page > 0 ? $page : 1;
        $offset = ($page - 1) * $perPage;
        $sliced = array_slice($items, $offset, $perPage);

        return new LengthAwarePaginator(
            $sliced,
            count($items),
            $perPage,
            $page,
            [
                'path' => LengthAwarePaginator::resolveCurrentPath(),
            ]
        );
    }

    private function sortInstalledAddons(array $items): array
    {
        usort($items, function (array $a, array $b) {
            if ($a['enabled'] !== $b['enabled']) {
                return $a['enabled'] ? -1 : 1;
            }

            $aName = $this->friendlyNameValue($a);
            $bName = $this->friendlyNameValue($b);

            return strcasecmp($aName, $bName);
        });

        return $items;
    }

    private function friendlyNameValue(array $item): string
    {
        return $item['friendly_name'] ?: $item['filename'];
    }

    /**
     * Invalidate the installed addons cache for a server.
     */
    private function invalidateInstalledCache(Server $server, string $type): void
    {
        Cache::forget("server:{$server->uuid}:installed:{$type}");
    }

    private function listDirectorySafely(Server $server, string $path): ?array
    {
        try {
            return $this->fileRepository->setServer($server)->getDirectory($path);
        } catch (\Throwable $e) {
            Log::debug('Installed addons scan skipped directory', ['path' => $path, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private function isJarLike(string $name): bool
    {
        $lower = strtolower($name);

        if (str_ends_with($lower, '.jar')) {
            return true;
        }

        if (str_ends_with($lower, '.disabled')) {
            $trimmed = substr($lower, 0, -strlen('.disabled'));

            return str_ends_with($trimmed, '.jar') || !str_contains($trimmed, '.');
        }

        return false;
    }

    private function stripDisabledSuffix(string $name): string
    {
        $lower = strtolower($name);

        if (str_ends_with($lower, '.jar.disabled')) {
            return substr($name, 0, -strlen('.disabled'));
        }

        if (str_ends_with($lower, '.disabled')) {
            return substr($name, 0, -strlen('.disabled'));
        }

        return $name;
    }

    private function makeFriendlyName(string $name): string
    {
        $base = $this->stripDisabledSuffix($name);
        $base = preg_replace('/\.jar$/i', '', $base);
        $base = preg_replace('/[_-]+/', ' ', $base);
        $base = trim(preg_replace('/\s+/', ' ', $base));

        if ($base === '') {
            return $this->stripDisabledSuffix($name);
        }

        // Preserve existing capitalization when any uppercase characters exist; otherwise title-case the name.
        $hasUpper = preg_match('/[A-Z]/', $base) > 0;

        return $hasUpper ? $base : Str::title($base);
    }

    private function hasDisabledSuffix(string $lower): bool
    {
        // Treat "*.jar.disabled" or "*.disabled" (when the remaining name has no other extension)
        // as disabled variants to stay compatible with common toggle patterns.
        if (str_ends_with($lower, '.disabled')) {
            $trimmed = substr($lower, 0, -strlen('.disabled'));

            return str_ends_with($trimmed, '.jar') || !str_contains($trimmed, '.');
        }

        return false;
    }

    private function targetNameForState(string $current, bool $enable): string
    {
        $lower = strtolower($current);

        if ($enable) {
            if ($this->hasDisabledSuffix($lower)) {
                return substr($current, 0, -strlen('.disabled'));
            }

            return $current;
        }

        if ($this->hasDisabledSuffix($lower)) {
            return $current;
        }

        return $current . '.disabled';
    }

    private function isDisabledFile(string $name): bool
    {
        $lower = strtolower($name);

        if (str_ends_with($lower, '.jar.disabled')) {
            return true;
        }

        if (str_ends_with($lower, '.disabled')) {
            $trimmed = substr($lower, 0, -strlen('.disabled'));

            return str_ends_with($trimmed, '.jar') || !str_contains($trimmed, '.');
        }

        return false;
    }

    private function formatTimestamp(mixed $value): ?string
    {
        if (empty($value)) {
            return null;
        }

        try {
            return Carbon::parse($value)->toIso8601String();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function joinPath(string $base, string $name): string
    {
        $normalizedBase = $this->normalizePath($base);

        return rtrim($normalizedBase, '/') . '/' . ltrim($name, '/');
    }

    private function normalizePath(string $path): string
    {
        $trimmed = '/' . trim($path, '/');

        return $trimmed === '//' ? '/' : $trimmed;
    }
}
