<?php

namespace Everest\Http\Controllers\Api\Application\Settings;

use Everest\Models\Setting;
use Illuminate\Http\JsonResponse;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Settings\UpdateFeatureTogglesRequest;

class FeaturesController extends ApplicationApiController
{
    /**
     * The toggleable optional modules and the config path each resolves to.
     * The config values are hydrated from `settings::modules:<key>:enabled`
     * by the SettingsServiceProvider, so reading config() reflects the stored
     * admin choice (falling back to the module config default).
     */
    public const FEATURES = [
        'custom_domains' => 'modules.custom_domains.enabled',
        'ai' => 'modules.ai.enabled',
        'mods' => 'modules.mods.enabled',
        'email' => 'modules.email.enabled',
        'webhooks' => 'modules.webhooks.enabled',
        'extensions' => 'modules.extensions.enabled',
        'tickets' => 'modules.tickets.enabled',
        'billing' => 'modules.billing.enabled',
    ];

    /**
     * FeaturesController constructor.
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Return the current on/off state of every toggleable feature.
     */
    public function index(): JsonResponse
    {
        $features = [];
        foreach (self::FEATURES as $key => $configPath) {
            $features[$key] = (bool) config($configPath, false);
        }

        return new JsonResponse(['data' => $features]);
    }

    /**
     * Persist the submitted feature toggles. Each value is written to the
     * `settings::modules:<key>:enabled` key the panel already bridges onto
     * config() at boot, so nothing else needs to change to take effect.
     *
     * @throws \Throwable
     */
    public function update(UpdateFeatureTogglesRequest $request): JsonResponse
    {
        $features = [];
        foreach (self::FEATURES as $key => $configPath) {
            if ($request->has($key)) {
                $value = $request->boolean($key);
                Setting::set('settings::modules:' . $key . ':enabled', $value ? 'true' : 'false');
                $features[$key] = $value;
            } else {
                // Not submitted — echo back the currently effective value so the
                // client gets a complete map. (config() is still the boot-time
                // value here; the just-written keys are captured above.)
                $features[$key] = (bool) config($configPath, false);
            }
        }

        return new JsonResponse(['data' => $features]);
    }
}
