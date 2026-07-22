<?php

namespace Everest\Http\ViewComposers;

use Illuminate\View\View;
use Everest\Models\Setting;

class AssetComposer
{
    /**
     * Provide access to the asset service in the views.
     */
    public function compose(View $view): void
    {
        $turnstileService = app(\Everest\Services\Auth\TurnstileService::class);

        $view->with('siteConfiguration', [
            'name' => config('app.name') ?? 'Everest',
            'logo' => config('app.logo') ?? null,
            'mode' => config('app.mode') ?? 'standard',
            'setup' => config('app.setup') ?? false,
            'debug' => env('APP_DEBUG') ?? false,
            'locale' => Setting::get('settings::app:locale') ?: (config('app.locale') ?: 'en'),
            'user_locale' => boolval(config('app.user_locale', true)),
            'speed_dial' => boolval(config('app.speed_dial', false)),
            'indicators' => boolval(config('app.indicators', false)),
            'captcha' => [
                'enabled' => $turnstileService->isEnabled(),
                'siteKey' => $turnstileService->getSiteKey() ?? '',
            ],
            'activity' => [
                'enabled' => [
                    'account' => boolval(config('activity.enabled.account', true)),
                    'server' => boolval(config('activity.enabled.server', true)),
                    'admin' => boolval(config('activity.enabled.admin', true)),
                ],
            ],
        ]);
    }
}
