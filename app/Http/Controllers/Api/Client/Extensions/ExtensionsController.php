<?php

namespace Everest\Http\Controllers\Api\Client\Extensions;

use Everest\Models\ExtensionConfig;
use Everest\Models\Server;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Extensions\GetServerExtensionsRequest;
use Everest\Models\Subuser;
use Everest\Services\Extensions\ExtensionCatalogService;
use Illuminate\Http\JsonResponse;

class ExtensionsController extends ClientApiController
{
    public function __construct(private ExtensionCatalogService $catalogService)
    {
        parent::__construct();
    }

    private function isExtensionDisabledForUser(Server $server, $user, string $extensionId): bool
    {
        if ($user->root_admin || $server->owner_id === $user->id) {
            return false;
        }

        $subuser = Subuser::query()
            ->where('user_id', $user->id)
            ->where('server_id', $server->id)
            ->first();

        return $subuser && in_array($extensionId, $subuser->disabled_extensions ?? [], true);
    }

    /**
     * Get all enabled extensions for a server.
     */
    public function index(GetServerExtensionsRequest $request, Server $server): JsonResponse
    {
        $enabledConfigs = ExtensionConfig::getEnabledForServer($server);
        $availableExtensions = [];
        foreach ($this->catalogService->getLocalExtensions() as $extension) {
            $availableExtensions[$extension['id']] = $extension;
        }

        $user = $request->user();

        $extensions = [];
        foreach ($enabledConfigs as $config) {
            if ($this->isExtensionDisabledForUser($server, $user, $config->extension_id)) {
                continue;
            }

            $extensionDef = $availableExtensions[$config->extension_id] ?? null;
            // Admin-only extensions (manifest route: null) have no server page
            // to link to, so they never appear in the server gallery.
            if ($extensionDef && ($extensionDef['hasServerPage'] ?? true)) {
                $extensions[] = [
                    'id' => $config->extension_id,
                    'name' => $extensionDef['name'],
                    'description' => $extensionDef['description'],
                    'icon' => $extensionDef['icon'],
                    'version' => $extensionDef['version'] ?? ($extensionDef['latestVersion'] ?? '1.0.0'),
                    'route' => $extensionDef['route'] ?? $config->extension_id,
                    'settings' => $config->settings ?? [],
                ];
            }
        }

        return new JsonResponse([
            'object' => 'list',
            'data' => $extensions,
        ]);
    }

    /**
     * Check if a specific extension is enabled for a server.
     */
    public function check(GetServerExtensionsRequest $request, Server $server, string $extensionId): JsonResponse
    {
        if ($this->isExtensionDisabledForUser($server, $request->user(), $extensionId)) {
            return new JsonResponse([
                'enabled' => false,
            ]);
        }

        $config = ExtensionConfig::getByExtensionId($extensionId);

        if (!$config || !$config->isServerEligible($server)) {
            return new JsonResponse([
                'enabled' => false,
            ]);
        }

        $availableExtensions = [];
        foreach ($this->catalogService->getLocalExtensions() as $extension) {
            $availableExtensions[$extension['id']] = $extension;
        }

        $extensionDef = $availableExtensions[$extensionId] ?? null;

        return new JsonResponse([
            'enabled' => true,
            'route' => $extensionDef['route'] ?? $extensionId,
        ]);
    }
}
