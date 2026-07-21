<?php

namespace Everest\Http\ViewComposers;

use Illuminate\View\View;

class ThemeComposer
{
    /**
     * The themeable color keys, in the semantic V2 model.
     */
    private const COLOR_KEYS = [
        'primary',
        'canvas',
        'surface',
        'surface_2',
        'border',
        'ink',
        'ink_muted',
        'accent',
        'warning',
        'danger',
    ];

    /**
     * Legacy V1 color aliases → the new semantic token they map onto. V1 (Blade
     * wrapper + the easy-peasy theme store) still reads these key names, so we
     * emit them alongside the V2 model and both UIs render from one source of
     * truth. V2 reads the canonical keys and ignores the aliases.
     */
    private const LEGACY_ALIASES = [
        'background' => 'canvas',
        'headers' => 'surface',
        'sidebar' => 'surface',
        'secondary' => 'surface_2',
    ];

    /**
     * Texture / feel keys.
     */
    private const FEEL_KEYS = [
        'radius',
        'grid_enabled',
        'grid_opacity',
        'grid_size',
        'aurora_enabled',
        'aurora_intensity',
    ];

    /**
     * Provide the resolved theme configuration to the views. Runtime overrides
     * (config('colors.*') / config('feel.*'), set by ThemeServiceProvider from
     * the `theme` table) take precedence over the module defaults.
     */
    public function compose(View $view): void
    {
        $colors = [];
        foreach (self::COLOR_KEYS as $key) {
            $colors[$key] = config('colors.' . $key) ?? config('modules.theme.colors.' . $key);
        }

        // Back-compat aliases so the V1 UI (which reads background/headers/
        // sidebar/secondary) keeps rendering off the new token set.
        foreach (self::LEGACY_ALIASES as $alias => $source) {
            $colors[$alias] = $colors[$source] ?? null;
        }

        $feel = [];
        foreach (self::FEEL_KEYS as $key) {
            $feel[$key] = config('feel.' . $key) ?? config('modules.theme.feel.' . $key);
        }

        $view->with('themeConfiguration', [
            'colors' => $colors,
            'feel' => $feel,
        ]);
    }
}
