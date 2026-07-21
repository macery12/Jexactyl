<?php

namespace Everest\Http\ViewComposers;

use Illuminate\View\View;
use Everest\Services\Landing\LandingConfigService;

/**
 * Injects the public landing page configuration onto every view so the v2 SPA
 * can render the customised landing page for logged-out visitors with no extra
 * request and no loading flash.
 */
class LandingComposer
{
    public function __construct(private LandingConfigService $landing)
    {
    }

    public function compose(View $view): void
    {
        $view->with('landingConfiguration', $this->landing->get());
    }
}
