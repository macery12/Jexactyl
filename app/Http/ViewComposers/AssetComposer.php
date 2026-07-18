<?php

namespace Everest\Http\ViewComposers;

use Everest\Models\Setting;
use Illuminate\View\View;

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
                    'account' => config('activity.enabled.account', true),
                    'server' => config('activity.enabled.server', true),
                    'admin' => config('activity.enabled.admin', true),
                ],
            ],
        ]);
    }
}
