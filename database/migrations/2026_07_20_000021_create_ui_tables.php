<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * UI/customization tables. Built-in theme_presets rows are seeded by
 * ThemePresetSeeder (docs/database-rebuild/04 D4) — structure only here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_links', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->text('url');
            $table->string('name');
            $table->boolean('visible');
            $table->timestamps();
        });

        Schema::create('webhook_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('key');
            $table->text('description');
            $table->boolean('enabled')->default(0);
            $table->timestamps();
        });

        Schema::create('theme', function (Blueprint $table) {
            $table->increments('id');
            $table->string('key')->unique();
            $table->text('value');
        });

        Schema::create('theme_presets', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name');
            $table->json('colors');
            $table->boolean('is_builtin')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('theme_presets');
        Schema::dropIfExists('theme');
        Schema::dropIfExists('webhook_events');
        Schema::dropIfExists('custom_links');
    }
};
