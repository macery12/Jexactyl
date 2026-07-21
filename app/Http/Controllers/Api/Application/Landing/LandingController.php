<?php

namespace Everest\Http\Controllers\Api\Application\Landing;

use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Models\Setting;
use Everest\Services\Landing\LandingConfigService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Landing\UpdateLandingConfigRequest;

class LandingController extends ApplicationApiController
{
    public function __construct(private LandingConfigService $landing)
    {
        parent::__construct();
    }

    /**
     * Return the current landing page configuration for the admin editor.
     */
    public function index(): JsonResponse
    {
        return new JsonResponse($this->landing->get());
    }

    /**
     * Persist the landing page configuration.
     *
     * @throws \Throwable
     */
    public function update(UpdateLandingConfigRequest $request): Response
    {
        $sections = array_values(array_map(function (array $section) {
            return [
                'id' => $section['id'],
                'enabled' => (bool) $section['enabled'],
                'order' => (int) $section['order'],
                'data' => $section['data'] ?? [],
            ];
        }, $request->validated('sections')));

        Setting::set('settings::modules:landing:enabled', $request->boolean('enabled') ? 'true' : 'false');
        Setting::set(LandingConfigService::CONFIG_KEY, json_encode(['sections' => $sections]));

        return $this->returnNoContent();
    }
}
