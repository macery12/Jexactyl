<?php

namespace Database\Seeders;

use Illuminate\Support\Str;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Built-in theme presets — the semantic 10-color V2 palette, extracted from the
 * legacy refresh_theme_presets_expanded_palette migration (database-rebuild
 * D4). Missing presets are always inserted. Existing built-ins are preserved
 * unless the operator explicitly chooses to replace them when re-seeding;
 * user-created presets (is_builtin = false) are never touched.
 */
class ThemePresetSeeder extends Seeder
{
    /**
     * @var list<array{string, array<string, string>}>
     */
    private array $existing = [];

    public function run(bool $deferOverwrite = false): void
    {
        $this->existing = [];

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

        $now = now();
        $created = 0;
        $createdNames = [];

        foreach ($builtin as [$name, $colors]) {
            $presetExists = DB::table('theme_presets')
                ->where('name', $name)
                ->where('is_builtin', true)
                ->exists();

            if ($presetExists) {
                $this->existing[] = [$name, $colors];

                continue;
            }

            DB::table('theme_presets')->insert([
                'name' => $name,
                'colors' => json_encode($colors),
                'is_builtin' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            ++$created;
            $createdNames[] = $name;
        }

        $duplicateCount = count($this->existing);

        $this->command->info(sprintf(
            'Added %d missing %s; found %d existing built-in %s.',
            $created,
            Str::plural('theme preset', $created),
            $duplicateCount,
            Str::plural('theme preset', $duplicateCount),
        ));

        if ($createdNames !== []) {
            $this->command->comment('Missing theme presets added:');
            foreach ($createdNames as $name) {
                $this->command->line('  + ' . $name);
            }
        }

        if ($deferOverwrite || $duplicateCount === 0) {
            return;
        }

        $this->applyOverwrite($this->confirmOverwrite());
    }

    public function hasExistingRecords(): bool
    {
        return $this->existing !== [];
    }

    public function confirmOverwrite(): bool
    {
        $duplicateCount = count($this->existing);

        if ($duplicateCount === 0) {
            return false;
        }

        return $this->command->confirm(
            sprintf(
                'Would you like to overwrite the %d existing built-in theme presets with the shipped palettes? This will replace any custom changes.',
                $duplicateCount,
            ),
            false,
        );
    }

    public function applyOverwrite(bool $overwrite): void
    {
        $duplicateCount = count($this->existing);

        if ($duplicateCount === 0) {
            return;
        }

        if (!$overwrite) {
            $this->command->comment(sprintf('Preserved %d existing built-in theme presets.', $duplicateCount));

            return;
        }

        foreach ($this->existing as [$name, $colors]) {
            DB::table('theme_presets')
                ->where('name', $name)
                ->where('is_builtin', true)
                ->update(['colors' => json_encode($colors), 'updated_at' => now()]);
        }

        $this->command->info(sprintf('Overwrote %d existing built-in theme presets.', $duplicateCount));
    }
}
