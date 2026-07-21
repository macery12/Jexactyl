<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Setting;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Services\Email\EmailRedactor;
use Everest\Services\Mods\ModrinthService;
use Everest\Http\Requests\Api\Application\Mods\GetModsAnalyticsRequest;
use Everest\Http\Requests\Api\Application\Mods\UpdateModsSettingsRequest;

class ModsController extends ApplicationApiController
{
    /**
     * ModsController constructor.
     */
    public function __construct(
        private ModrinthService $modrinthService
    ) {
        parent::__construct();
    }

    /**
     * Update the mods settings for the Panel.
     *
     * @throws \Throwable
     */
    public function update(UpdateModsSettingsRequest $request): Response
    {
        foreach ($request->normalize() as $key => $value) {
            Setting::set('settings::modules:mods:' . $key, $value);
        }

        // Clear config cache to ensure new settings are loaded
        // SECURITY: Command name is hardcoded - never use dynamic command names with Artisan::call()
        \Artisan::call('config:clear');

        $activitySettings = EmailRedactor::redactSensitivePayload(
            $request->all(),
            ['api_key', 'token', 'secret', 'password', 'authorization', 'key']
        );

        Activity::event('admin:mods:update')
            ->property('settings', $activitySettings)
            ->description('Mods module settings were updated')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Get mods analytics and rate limit usage.
     */
    public function analytics(GetModsAnalyticsRequest $request): JsonResponse
    {
        $modrinthRateLimit = $this->modrinthService->getRateLimitUsage();

        return response()->json([
            'modrinth_rate_limit' => $modrinthRateLimit,
        ]);
    }
}
