<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('download_queue', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('uuid')->unique();

            // servers.id and users.id use increments() = unsigned INT
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('user_id')->nullable();
            $table->unsignedBigInteger('parent_id')->nullable(); // self-ref; matches bigIncrements above

            $table->string('provider', 64);
            $table->string('source', 32);                       // mod, plugin, modpack
            $table->string('project_id', 128);
            $table->string('file_id', 128);

            // Pre-resolved CDN URL for modpack file children — avoids a second API call.
            $table->string('download_url', 2048)->nullable();
            // Destination path on the server (e.g. "mods/sodium.jar") for modpack files.
            $table->string('install_path', 512)->nullable();
            // File hash from the modpack index, verified after download.
            $table->string('file_hash_sha512', 128)->nullable();
            // Hash algorithm for the value stored in file_hash_sha512 (modrinth: sha512).
            $table->string('hash_algo', 16)->default('sha512');

            // On parent modpack items: total child mod files expected.
            $table->unsignedInteger('total_children')->nullable();
            // Atomically incremented as each child completes; parent finishes when this equals total_children.
            $table->unsignedInteger('completed_children')->default(0);
            $table->unsignedInteger('failed_children')->default(0);

            $table->string('file_name', 255)->nullable();
            $table->text('error_message')->nullable();
            // Captured stdout/stderr from the Wings install script, shown in the "View log" modal.
            $table->text('install_log')->nullable();

            // Short string updated by InstallModpackJob as it progresses through preparation phases.
            // Null once total_children is set (progress bar takes over). Ignored for child items.
            $table->string('phase', 64)->nullable();
            $table->string('status', 16)->default('pending');   // pending, downloading, completed, failed

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
    }
};
