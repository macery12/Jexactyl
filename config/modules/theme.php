<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Theme Configuration
    |--------------------------------------------------------------------------
    |
    | These settings drive the Panel's V2 design tokens. They can be configured
    | from the admin Theme page (persisted in the `theme` table) and overridden
    | here / via env for ease of use.
    |
    | The model is semantic & layered:
    |   - primary            the brand color (buttons, links, focus, accents)
    |   - canvas             the app background
    |   - surface            panels / sidebar
    |   - surface_2          elevated surfaces (raised cards, inputs)
    |   - border             hairline borders
    |   - ink / ink_muted    primary / secondary text
    |   - accent / warning / danger   status colors
    |
    | Hover/active tints and the faint ink/border shades are DERIVED from these
    | in the frontend (color-mix), so the brand knob "just works".
    |
    | Legacy keys (secondary/background/headers/sidebar) are still read as a
    | fallback by the composer so un-migrated installs keep rendering.
    |
    */
    'colors' => [
        'primary' => env('THEME_COLORS_PRIMARY', '#0047fc'),

        'canvas' => env('THEME_COLORS_CANVAS', '#0a0a0f'),
        'surface' => env('THEME_COLORS_SURFACE', '#121219'),
        'surface_2' => env('THEME_COLORS_SURFACE_2', '#1a1a24'),
        'border' => env('THEME_COLORS_BORDER', '#2e2e3d'),

        'ink' => env('THEME_COLORS_INK', '#f4f4f7'),
        'ink_muted' => env('THEME_COLORS_INK_MUTED', '#9a9aae'),

        'accent' => env('THEME_COLORS_ACCENT', '#18d39a'),
        'warning' => env('THEME_COLORS_WARNING', '#f5a623'),
        'danger' => env('THEME_COLORS_DANGER', '#f1545b'),
    ],

    /*
    | Texture / feel — non-color presentation knobs. Booleans are coerced from
    | the stored "true"/"false" strings by ThemeServiceProvider's $map.
    */
    'feel' => [
        'radius' => env('THEME_FEEL_RADIUS', 'soft'), // sharp | soft | round

        'grid_enabled' => env('THEME_FEEL_GRID_ENABLED', true),
        'grid_opacity' => env('THEME_FEEL_GRID_OPACITY', 60), // 0..100
        'grid_size' => env('THEME_FEEL_GRID_SIZE', 28), // px

        'aurora_enabled' => env('THEME_FEEL_AURORA_ENABLED', true),
        'aurora_intensity' => env('THEME_FEEL_AURORA_INTENSITY', 100), // 0..100
    ],
];
