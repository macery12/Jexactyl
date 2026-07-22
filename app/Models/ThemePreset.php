<?php

namespace Everest\Models;

/**
 * Everest\Models\ThemePreset.
 *
 * @property int $id
 * @property string $name
 * @property array $colors
 * @property bool $is_builtin
 */
class ThemePreset extends Model
{
    protected $table = 'theme_presets';

    protected $fillable = ['name', 'colors', 'is_builtin'];

    protected $casts = [
        'colors'     => 'array',
        'is_builtin' => 'boolean',
    ];

    public static array $validationRules = [
        'name' => 'required|string|between:1,191',
    ];
}
