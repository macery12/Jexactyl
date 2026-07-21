<?php

namespace Everest\Http\Controllers\Api\Application\Theme;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Models\ThemePreset;
use Everest\Contracts\Repository\ThemeRepositoryInterface;
use Everest\Http\Requests\Api\Application\Theme\UpdateThemeRequest;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;

class ThemePresetController extends ApplicationApiController
{
    public function __construct(
        private ThemeRepositoryInterface $theme
    ) {
        parent::__construct();
    }

    /**
     * Return all theme presets.
     */
    public function index(UpdateThemeRequest $request): JsonResponse
    {
        $presets = ThemePreset::orderBy('is_builtin', 'desc')->orderBy('id')->get();

        return response()->json(['presets' => $presets->toArray()]);
    }

    /**
     * The themeable color keys captured by a preset (the semantic V2 model).
     * Feel/texture settings are global and intentionally not part of a preset.
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
     * Save the current theme colors as a new named preset.
     */
    public function store(UpdateThemeRequest $request): JsonResponse
    {
        $request->validate(['name' => 'required|string|max:191']);

        $colors = [];
        foreach (self::COLOR_KEYS as $key) {
            $colors[$key] = config('colors.' . $key) ?? config('modules.theme.colors.' . $key);
        }

        $preset = ThemePreset::create([
            'name'       => $request->input('name'),
            'colors'     => $colors,
            'is_builtin' => false,
        ]);

        return response()->json(['preset' => $preset->toArray()], 201);
    }

    /**
     * Apply a preset's colors to the active theme.
     */
    public function apply(UpdateThemeRequest $request, ThemePreset $theme_preset): JsonResponse
    {
        foreach ($theme_preset->colors as $key => $value) {
            $this->theme->set('theme::colors:' . $key, $value);
        }

        return response()->json(['colors' => $theme_preset->colors]);
    }

    /**
     * Delete a user-created preset. Built-in presets cannot be deleted.
     */
    public function delete(UpdateThemeRequest $request, ThemePreset $theme_preset): Response
    {
        if ($theme_preset->is_builtin) {
            abort(403, 'Built-in presets cannot be deleted.');
        }

        $theme_preset->delete();

        return $this->returnNoContent();
    }
}
