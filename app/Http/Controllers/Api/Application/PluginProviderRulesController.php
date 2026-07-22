<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Nest;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Everest\Models\PluginProviderRule;
use Everest\Http\Requests\Api\Application\Mods\GetModsAnalyticsRequest;
use Everest\Http\Requests\Api\Application\Plugins\UpdatePluginProviderRulesRequest;

class PluginProviderRulesController extends ApplicationApiController
{
    private const CACHE_KEY = 'plugins:nests-eggs';
    private const CACHE_SECONDS = 300;

    public function index(GetModsAnalyticsRequest $request): JsonResponse
    {
        $nests = Cache::remember(self::CACHE_KEY, self::CACHE_SECONDS, function () {
            return Nest::query()->with('eggs:id,nest_id,name')->get(['id', 'name']);
        });

        $rules = PluginProviderRule::all()->keyBy('provider_key');

        return response()->json([
            'nests' => $nests,
            'rules' => $rules,
        ]);
    }

    public function update(UpdatePluginProviderRulesRequest $request): JsonResponse
    {
        $data = $request->validated();

        PluginProviderRule::updateOrCreate(
            ['provider_key' => $data['provider_key']],
            [
                'enabled_global' => $data['enabled_global'],
                'allowed_nest_ids' => $data['allowed_nest_ids'] ?? [],
                'allowed_egg_ids' => $data['allowed_egg_ids'] ?? [],
            ],
        );

        Cache::forget(self::CACHE_KEY);

        return response()->json([
            'success' => true,
        ]);
    }
}
