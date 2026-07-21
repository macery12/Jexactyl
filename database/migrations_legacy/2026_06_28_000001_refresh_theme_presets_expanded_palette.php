<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Database\Migrations\Migration;

/**
 * Refreshes the built-in theme presets for the redesigned, semantic V2 theme
 * model (full 10-color palette instead of the legacy 5 keys). User-created
 * presets (is_builtin = false) are left untouched.
 */
return new class () extends Migration {
    public function up(): void
    {
        // Standard status colors, shared across the built-ins.
        $status = [
            'accent'  => '#18d39a',
            'warning' => '#f5a623',
            'danger'  => '#f1545b',
        ];

        // Coherent neutral ramps (canvas → surface → elevated → border → ink).
        $ink = ['ink' => '#f4f4f7', 'ink_muted' => '#9a9aae'];

        $void = array_merge([
            'canvas' => '#0a0a0f', 'surface' => '#121219', 'surface_2' => '#1a1a24', 'border' => '#2e2e3d',
        ], $ink);

        $midnight = [
            'canvas' => '#0b1020', 'surface' => '#121a2e', 'surface_2' => '#1b2540', 'border' => '#2b3550',
            'ink' => '#eef2ff', 'ink_muted' => '#94a3c8',
        ];

        $slate = [
            'canvas' => '#0f1115', 'surface' => '#181b21', 'surface_2' => '#21252e', 'border' => '#333a45',
            'ink' => '#f1f5f9', 'ink_muted' => '#98a2b3',
        ];

        $pureBlack = [
            'canvas' => '#000000', 'surface' => '#0a0a0a', 'surface_2' => '#141414', 'border' => '#262626',
            'ink' => '#fafafa', 'ink_muted' => '#8a8a8a',
        ];

        $warm = [
            'canvas' => '#0f0d0a', 'surface' => '#18140f', 'surface_2' => '#221c14', 'border' => '#3a3024',
            'ink' => '#faf6f0', 'ink_muted' => '#b3a48f',
        ];

        $builtin = [
            ['M12Labs Blue',    array_merge(['primary' => '#0047fc'], $void, $status)],
            ['Iris Purple',     array_merge(['primary' => '#6d5efc'], $void, $status)],
            ['Jexactyl Green',  array_merge(['primary' => '#16a34a'], $void, $status)],
            ['Microsoft Teal',  array_merge(['primary' => '#12aaaa'], $void, $status)],
            ['Brick Red',       array_merge(['primary' => '#ef4444'], $void, $status)],
            ['Midnight',        array_merge(['primary' => '#3b82f6'], $midnight, $status)],
            ['Slate',           array_merge(['primary' => '#0047fc'], $slate, $status)],
            ['Pure Black',      array_merge(['primary' => '#0047fc'], $pureBlack, $status)],
            ['Amber Forge',     array_merge(['primary' => '#f59e0b'], $warm, $status)],
        ];

        // Drop the old built-ins (legacy 5-key palette) and reseed.
        DB::table('theme_presets')->where('is_builtin', true)->delete();

        foreach ($builtin as [$name, $colors]) {
            DB::table('theme_presets')->insert([
                'name'       => $name,
                'colors'     => json_encode($colors),
                'is_builtin' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // Non-reversible data refresh; remove the reseeded built-ins.
        DB::table('theme_presets')->where('is_builtin', true)->delete();
    }
};
