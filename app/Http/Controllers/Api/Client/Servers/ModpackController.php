<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Extensions\Packages\minecraft_startup_editor\MinecraftStartupOptions;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Servers\Mods\GetModpackRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\InstallModpackRequest;
use Everest\Jobs\InstallModpackJob;
use Everest\Models\DownloadQueue;
use Everest\Models\Server;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Services\Mods\CurseForgeService;
use Everest\Services\Mods\ModpackPreviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

/**
 * Modpack browsing + install. Modpacks are served exclusively by CurseForge and
 * are strictly filtered to the server's egg: only the detected loader's modpacks
 * are shown, and only versions matching the server's Minecraft version.
 */
class ModpackController extends ClientApiController
{
    /** Loaders that support modpacks. Paper/Spigot/etc. do not. */
    private const MODPACK_LOADERS = ['forge', 'neoforge', 'fabric', 'quilt'];

    public function __construct(
        private CurseForgeService     $curseForge,
        private ModpackPreviewService $previewService,
        private DaemonFileRepository  $fileRepository,
    ) {
        parent::__construct();
    }

    /**
     * Search modpacks. Loader, Minecraft version and sort are prefilled from the
     * server's egg but can be overridden by the client. Defaults to most popular.
     */
    public function search(GetModpackRequest $request, Server $server): JsonResponse
    {
        $loader = $this->resolveLoaderParam($request->input('loader'), $server);
        if ($loader === null) {
            // Not a modpack-capable egg and no valid override — nothing to show.
            return response()->json(['data' => [], 'pagination' => ['index' => 0, 'pageSize' => 0, 'resultCount' => 0, 'totalCount' => 0]]);
        }

        $params = [
            'searchFilter'  => $request->input('searchFilter'),
            // CurseForge sortField: 2 = Popularity (default for "most popular").
            'sortField'     => $request->input('sortField') ?: '2',
            'sortOrder'     => 'desc',
            'gameVersion'   => $this->resolveGameVersionParam($request->input('gameVersion'), $server),
            'pageSize'      => $request->input('pageSize', 20),
            'index'         => $request->input('index', 0),
            'modLoaderType' => CurseForgeService::loaderTypeId($loader),
        ];

        try {
            $result = $this->curseForge->searchModpacks(array_filter($params, fn ($v) => $v !== null && $v !== ''));

            return response()->json($result);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Return the list of release Minecraft versions (newest first) for the
     * version filter dropdown.
     */
    public function minecraftVersions(GetModpackRequest $request, Server $server): JsonResponse
    {
        try {
            return response()->json(['data' => $this->curseForge->getMinecraftVersions()]);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Detect whether a mod loader is already installed on the server by scanning
     * its files for known markers. Used by the install wizard to decide whether to
     * offer installing the modpack's loader.
     *
     * Returns: { has_loader: bool, detected: 'forge'|'neoforge'|'fabric'|'quilt'|null }
     */
    public function loaderStatus(GetModpackRequest $request, Server $server): JsonResponse
    {
        try {
            $root = collect($this->fileRepository->setServer($server)->getDirectory('/'))
                ->pluck('name')
                ->all();
        } catch (\Exception) {
            // Server offline / unreachable — treat as undetermined (no loader).
            return response()->json(['has_loader' => false, 'detected' => null]);
        }

        $names = array_map('strtolower', $root);
        $has   = fn (string $n) => in_array($n, $names, true);

        $detected = null;
        if ($has('fabric-server-launch.jar')) {
            $detected = 'fabric';
        } elseif ($has('quilt-server-launch.jar')) {
            $detected = 'quilt';
        } elseif ($has('unix_args.txt') || in_array('libraries', $names, true)) {
            // Forge/NeoForge 1.17+ leave a unix_args.txt (symlink into libraries).
            // Distinguish via the libraries subtree when present.
            $detected = $this->detectForgeFamily($server) ?? ($has('unix_args.txt') ? 'forge' : null);
        }

        return response()->json([
            'has_loader' => $detected !== null,
            'detected'   => $detected,
        ]);
    }

    /** Look under libraries/net for a Forge vs NeoForge install. */
    private function detectForgeFamily(Server $server): ?string
    {
        try {
            $net = collect($this->fileRepository->setServer($server)->getDirectory('/libraries/net'))
                ->pluck('name')
                ->map('strtolower')
                ->all();
        } catch (\Exception) {
            return null;
        }

        if (in_array('neoforged', $net, true)) {
            return 'neoforge';
        }
        if (in_array('minecraftforge', $net, true)) {
            return 'forge';
        }

        return null;
    }

    /**
     * Get a single modpack project's details.
     */
    public function show(GetModpackRequest $request, Server $server, string $projectId): JsonResponse
    {
        try {
            $result = $this->curseForge->getModpack((int) $projectId);

            return response()->json($result);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * List versions for a modpack, strictly filtered by the server's loader + MC version.
     */
    public function versions(GetModpackRequest $request, Server $server, string $projectId): JsonResponse
    {
        $loader        = $this->resolveLoaderParam($request->input('loader'), $server);
        $modLoaderType = CurseForgeService::loaderTypeId($loader);
        $gameVersion   = $this->resolveGameVersionParam($request->input('gameVersion'), $server);

        try {
            $versions = $this->curseForge->getModpackVersions((int) $projectId, $gameVersion, $modLoaderType);

            return response()->json(['data' => $versions]);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Download and parse a modpack .zip to produce an install preview, including
     * version/loader mismatch flags and the list of files that cannot be
     * auto-downloaded (author disabled third-party distribution).
     */
    public function preview(GetModpackRequest $request, Server $server, string $projectId, string $versionId): JsonResponse
    {
        try {
            $preview = $this->previewService->preview((int) $projectId, (int) $versionId);

            $serverLoader  = $this->resolveLoader($server);
            $serverVersion = $this->resolveMinecraftVersion($server);

            $loaderMismatch  = $serverLoader && $preview['loader']
                && strtolower($preview['loader']) !== strtolower($serverLoader);
            $versionMismatch = $serverVersion && $preview['minecraft_version']
                && $preview['minecraft_version'] !== $serverVersion;

            return response()->json(array_merge($preview, [
                'server_loader'           => $serverLoader,
                'server_version'          => $serverVersion,
                'loader_mismatch'         => $loaderMismatch,
                'version_mismatch'        => $versionMismatch,
                'required_version'        => $preview['minecraft_version'],
                'required_loader'         => $preview['loader'],
                'required_loader_version' => $preview['loader_version'],
            ]));
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Kick off a modpack install.
     *
     * Expected body:
     *   project_id     int   (required) CurseForge modpack id
     *   file_id        int   (required) CurseForge modpack file (version) id
     *   wipe_server    bool  wipe the entire server first (clean install)
     *   install_loader bool  install the modpack's mod loader via the script endpoint
     */
    public function install(InstallModpackRequest $request, Server $server): JsonResponse
    {
        if (! $server->node->isSupercharged()) {
            return response()->json([
                'error' => 'Modpack installation requires a supercharged node (Wings-RS). This server\'s node does not support the script execution API.',
            ], 422);
        }

        $projectId = (int) $request->input('project_id');
        $fileId    = (int) $request->input('file_id');

        // Cheap pre-check: fail fast if the modpack file itself can't be downloaded.
        // The actual zip + mod downloads happen on the Wings node via the install script.
        try {
            $file = $this->curseForge->getModpackFile($projectId, $fileId);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }

        if (empty($file['downloadUrl'])) {
            return response()->json(['error' => 'This modpack file cannot be downloaded (distribution disabled by the author).'], 422);
        }

        $parent = DownloadQueue::create([
            'uuid'       => Str::uuid()->toString(),
            'server_id'  => $server->id,
            'user_id'    => auth()->id(),
            'provider'   => 'curseforge',
            'source'     => 'modpack',
            'project_id' => (string) $projectId,
            'file_id'    => (string) $fileId,
            'file_name'  => $request->input('modpack_name') ?: null,
            'status'     => DownloadQueue::STATUS_PENDING,
        ]);

        dispatch(new InstallModpackJob(
            parent:        $parent,
            wipeServer:    (bool) $request->input('wipe_server', false),
            installLoader: (bool) $request->input('install_loader', false),
        ));

        return response()->json([
            'queued'   => true,
            'queue_id' => $parent->uuid,
        ], 202);
    }

    /**
     * Detect the loader slug from the server's egg name.
     * Returns null if the egg isn't a modpack-capable mod loader (e.g. Paper).
     */
    private function resolveLoader(Server $server): ?string
    {
        $eggName  = $server->egg?->name ?? '';
        $detected = MinecraftStartupOptions::detectLoader($eggName);

        if (!$detected || !in_array($detected, self::MODPACK_LOADERS, true)) {
            return null;
        }

        return $detected;
    }

    /**
     * Resolve the loader to filter by: a valid client override (one of the four
     * modpack loaders) wins, otherwise fall back to the server's detected loader.
     */
    private function resolveLoaderParam(?string $input, Server $server): ?string
    {
        $input = $input !== null ? strtolower(trim($input)) : '';

        if (in_array($input, self::MODPACK_LOADERS, true)) {
            return $input;
        }

        return $this->resolveLoader($server);
    }

    /**
     * Resolve the Minecraft version filter:
     *   "any"    => no version filter
     *   "latest" => newest release version from CurseForge
     *   ""       => the server's detected version
     *   x.y.z    => that version
     */
    private function resolveGameVersionParam(?string $input, Server $server): ?string
    {
        $input = $input !== null ? trim($input) : '';

        if ($input === '') {
            return $this->resolveMinecraftVersion($server);
        }

        $lower = strtolower($input);
        if ($lower === 'any') {
            return null;
        }
        if ($lower === 'latest') {
            return $this->curseForge->latestMinecraftVersion();
        }

        return $input;
    }

    /**
     * Read the Minecraft version from the server's startup variables.
     */
    private function resolveMinecraftVersion(Server $server): ?string
    {
        $varNames = ['MINECRAFT_VERSION', 'MC_VERSION', 'VANILLA_VERSION'];
        foreach ($server->variables as $variable) {
            if (in_array($variable->env_variable, $varNames, true) && !empty($variable->server_value)) {
                return $variable->server_value;
            }
        }

        return null;
    }
}
