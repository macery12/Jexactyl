<?php

namespace Everest\Http\Controllers\Api\Application\Theme;

use Everest\Models\Theme;
use Illuminate\Http\Response;
use Everest\Contracts\Repository\ThemeRepositoryInterface;
use Everest\Http\Requests\Api\Application\Theme\UpdateThemeRequest;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;

class ThemeController extends ApplicationApiController
{
    /**
     * Settings the theme endpoint is allowed to write, as `<group>:<name>`
     * suffixes (stored under `theme::<suffix>`). Mirrors ThemeServiceProvider.
     */
    private const ALLOWED_KEYS = [
        'colors:primary',
        'colors:canvas',
        'colors:surface',
        'colors:surface_2',
        'colors:border',
        'colors:ink',
        'colors:ink_muted',
        'colors:accent',
        'colors:warning',
        'colors:danger',
        'feel:radius',
        'feel:grid_enabled',
        'feel:grid_opacity',
        'feel:grid_size',
        'feel:aurora_enabled',
        'feel:aurora_intensity',
    ];

    /**
     * ThemeController constructor.
     */
    public function __construct(
        private ThemeRepositoryInterface $theme
    ) {
        parent::__construct();
    }

    /**
     * Update a single theme setting (color or feel). Bare keys (e.g. "primary")
     * are treated as color keys for backward compatibility; namespaced keys
     * (e.g. "colors:primary", "feel:grid_enabled") are stored as-is.
     *
     * @throws \Throwable
     */
    public function colors(UpdateThemeRequest $request): Response
    {
        $request->validate([
            'key' => 'required|string',
            'value' => 'present|string',
        ]);

        $key = $request->input('key');
        $suffix = str_contains($key, ':') ? $key : 'colors:' . $key;

        if (!in_array($suffix, self::ALLOWED_KEYS, true)) {
            abort(422, 'Unknown theme key: ' . $suffix);
        }

        $this->theme->set('theme::' . $suffix, $request->input('value'));

        return $this->returnNoContent();
    }

    /**
     * Reset all of the theme keys to factory defaults.
     */
    public function reset(UpdateThemeRequest $request): Response
    {
        foreach ($this->theme->all() as $setting) {
            $setting->delete();
        }

        return $this->returnNoContent();
    }
}
