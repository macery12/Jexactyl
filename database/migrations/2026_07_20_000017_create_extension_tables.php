<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Extension system core: per-extension config/state, file snapshots for
 * rollback, and third-party extension repositories.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('extension_configs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('extension_id')->unique();
            $table->boolean('enabled')->default(0);
            $table->json('allowed_nests')->nullable();
            $table->json('allowed_eggs')->nullable();
            $table->json('settings')->nullable();
            $table->timestamps();

            // Historical chain carries a plain index alongside the unique — kept for fidelity.
            $table->index('extension_id');
        });

        Schema::create('extension_file_snapshots', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id')->index();
            $table->unsignedInteger('actor_id')->nullable()->index();
            $table->string('extension_id')->index();
            $table->string('action')->index();
            $table->longText('files');
            $table->timestamps();

            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('actor_id')->references('id')->on('users')->onDelete('set null');
        });

        Schema::create('extension_repositories', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('slug')->unique();
            $table->string('name');
            $table->text('manifest_url');
            $table->text('homepage_url')->nullable();
            $table->boolean('enabled')->default(1);
            $table->boolean('is_official')->default(0);
            $table->timestamp('risk_acknowledged_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('extension_repositories');
        Schema::dropIfExists('extension_file_snapshots');
        Schema::dropIfExists('extension_configs');
    }
};
