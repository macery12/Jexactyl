<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Extension marketplace: installed packages + their tracked files, plugin
 * provider rules, marketplace install telemetry and the server download queue
 * (self-referencing parent_id for batched downloads).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('extension_packages', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('extension_id')->unique();
            $table->string('package_id')->index();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('author')->nullable();
            $table->string('icon')->default('puzzle');
            $table->string('route')->nullable();
            $table->string('installed_version');
            $table->unsignedBigInteger('source_repository_id')->nullable();
            $table->string('source_repository_name')->nullable();
            $table->text('source_registry_url')->nullable();
            $table->text('source_archive_url')->nullable();
            $table->string('package_checksum', 64)->nullable();
            $table->json('manifest');
            $table->timestamp('installed_at')->nullable();
            $table->timestamps();

            $table->foreign('source_repository_id')->references('id')->on('extension_repositories')->onDelete('set null');
        });

        Schema::create('extension_package_files', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('extension_package_id');
            $table->string('path')->unique();
            $table->string('operation');
            $table->string('installed_checksum', 64);
            $table->text('backup_path')->nullable();
            $table->string('backup_checksum', 64)->nullable();
            $table->timestamps();

            $table->foreign('extension_package_id')->references('id')->on('extension_packages')->onDelete('cascade');
        });

        Schema::create('plugin_provider_rules', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('provider_key')->unique();
            $table->boolean('enabled_global')->default(0);
            $table->json('allowed_nest_ids')->nullable();
            $table->json('allowed_egg_ids')->nullable();
            $table->timestamps();
        });

        Schema::create('marketplace_install_logs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('provider', 64);
            $table->string('type', 32);
            $table->string('project_id', 128);
            $table->unsignedBigInteger('file_size_bytes')->default(0);
            $table->string('status', 16);
            $table->unsignedInteger('server_id')->nullable()->index();
            $table->unsignedInteger('user_id')->nullable()->index();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['provider', 'status']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('set null');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
        });

        Schema::create('download_queue', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('user_id')->nullable();
            $table->unsignedBigInteger('parent_id')->nullable();
            $table->string('provider', 64);
            $table->string('source', 32);
            $table->string('project_id', 128);
            $table->string('file_id', 128);
            $table->string('download_url', 2048)->nullable();
            $table->string('install_path', 512)->nullable();
            $table->string('file_hash_sha512', 128)->nullable();
            $table->string('hash_algo', 16)->default('sha512');
            $table->unsignedInteger('total_children')->nullable();
            $table->unsignedInteger('completed_children')->default(0);
            $table->unsignedInteger('failed_children')->default(0);
            $table->string('file_name', 255)->nullable();
            $table->text('error_message')->nullable();
            $table->text('install_log')->nullable();
            $table->string('phase', 64)->nullable();
            $table->string('status', 16)->default('pending');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['server_id', 'status']);
            $table->index(['server_id', 'created_at']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('parent_id')->references('id')->on('download_queue')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('download_queue');
        Schema::dropIfExists('marketplace_install_logs');
        Schema::dropIfExists('plugin_provider_rules');
        Schema::dropIfExists('extension_package_files');
        Schema::dropIfExists('extension_packages');
    }
};
