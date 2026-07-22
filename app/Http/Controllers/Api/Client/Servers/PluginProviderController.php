<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Everest\Models\Setting;
use Illuminate\Http\JsonResponse;
use Everest\Services\Plugins\ProviderAccessService;
use Everest\Http\Controllers\Api\Client\ClientApiController;

class PluginProviderController extends ClientApiController
{
    public function __construct(private ProviderAccessService $providerAccessService)
    {
        parent::__construct();
    }

    public function capabilities(Server $server): JsonResponse
    {
        $modsEnabled = (bool) Setting::get('settings::modules:mods:enabled', config('modules.mods.enabled', false));

        if (!$modsEnabled) {
            return response()->json([
                'mods' => [],
                'modpacks' => [],
                'plugins' => [],
            ]);
        }

        return response()->json($this->providerAccessService->getAllowedProvidersForServer($server->egg_id, $server->nest_id));
    }

    public function index(Server $server): JsonResponse
    {
        $modsEnabled = (bool) Setting::get('settings::modules:mods:enabled', config('modules.mods.enabled', false));

        if (!$modsEnabled) {
            return response()->json([
                'mods' => [],
                'modpacks' => [],
                'plugins' => [],
                'installed' => true,
            ]);
        }

        $providers = $this->providerAccessService->getAllowedProvidersForServer($server->egg_id, $server->nest_id);

        return response()->json(array_merge($providers, ['installed' => true]));
    }
}
