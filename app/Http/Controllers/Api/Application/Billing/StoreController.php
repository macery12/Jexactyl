<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Everest\Models\Setting;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Services\Billing\StoreConfigService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Billing\GetStoreConfigRequest;
use Everest\Http\Requests\Api\Application\Billing\UpdateStoreConfigRequest;

class StoreController extends ApplicationApiController
{
    public function __construct(private StoreConfigService $store)
    {
        parent::__construct();
    }

    /**
     * Return the current storefront configuration for the admin editor.
     */
    public function index(GetStoreConfigRequest $request): JsonResponse
    {
        return new JsonResponse($this->store->get());
    }

    /**
     * Persist the storefront configuration.
     *
     * @throws \Throwable
     */
    public function update(UpdateStoreConfigRequest $request): Response
    {
        $sections = array_values(array_map(function (array $section) {
            return [
                'id' => $section['id'],
                'enabled' => (bool) $section['enabled'],
                'order' => (int) $section['order'],
                'data' => $section['data'] ?? [],
            ];
        }, $request->validated('sections')));

        Setting::set('settings::modules:billing:store:enabled', $request->boolean('enabled') ? 'true' : 'false');
        Setting::set(StoreConfigService::CONFIG_KEY, json_encode(['sections' => $sections]));

        return $this->returnNoContent();
    }
}
