<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('theme_presets', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name');
            $table->json('colors');
            $table->boolean('is_builtin')->default(false);
            $table->timestamps();
        });

        $builtin = [
            [
                'name' => 'M12Labs Blue',
                'colors' => json_encode([
                    'primary'    => '#0047fc',
                    'secondary'  => '#27272a',
                    'background' => '#141414',
                    'headers'    => '#171717',
                    'sidebar'    => '#18181b',
                ]),
                'is_builtin' => true,
            ],
            [
                'name' => 'Jexactyl Green',
                'colors' => json_encode([
                    'primary'    => '#16a34a',
                    'secondary'  => '#27272a',
                    'background' => '#141414',
                    'headers'    => '#171717',
                    'sidebar'    => '#18181b',
                ]),
                'is_builtin' => true,
            ],
            [
                'name' => 'Iris Purple',
                'colors' => json_encode([
                    'primary'    => '#9D00FF',
                    'secondary'  => '#27272a',
                    'background' => '#141414',
                    'headers'    => '#171717',
                    'sidebar'    => '#18181b',
                ]),
                'is_builtin' => true,
            ],
            [
                'name' => 'Midnight',
                'colors' => json_encode([
                    'primary'    => '#32559f',
                    'secondary'  => '#1a1a2e',
                    'background' => '#0f0f0f',
                    'headers'    => '#16213e',
                    'sidebar'    => '#1a1a2e',
                ]),
                'is_builtin' => true,
            ],
            [
                'name' => 'Amber Forge',
                'colors' => json_encode([
                    'primary'    => '#FFA500',
                    'secondary'  => '#292520',
                    'background' => '#151210',
                    'headers'    => '#1a1512',
                    'sidebar'    => '#1c1710',
                ]),
                'is_builtin' => true,
            ],
        ];

        foreach ($builtin as $preset) {
            DB::table('theme_presets')->insert(array_merge($preset, [
                'created_at' => now(),
                'updated_at' => now(),
            ]));
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('theme_presets');
    }
};
