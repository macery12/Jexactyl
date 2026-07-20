<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('marketplace_install_logs', function (Blueprint $table) {
            $table->id();
            $table->string('provider', 64); // modrinth, curseforge, spigot
            $table->string('type', 32);     // mod, plugin, modpack
            $table->string('project_id', 128);
            $table->unsignedBigInteger('file_size_bytes')->default(0);
            $table->string('status', 16);   // success, failed
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('user_id')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['provider', 'status']);
            $table->index('server_id');
            $table->index('user_id');
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('set null');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('marketplace_install_logs');
    }
};
