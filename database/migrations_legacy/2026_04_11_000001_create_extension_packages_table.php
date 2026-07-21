<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('extension_packages', function (Blueprint $table) {
            $table->id();
            $table->string('extension_id')->unique();
            $table->string('package_id')->index();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('author')->nullable();
            $table->string('icon')->default('puzzle');
            $table->string('route')->nullable();
            $table->string('installed_version');
            $table->foreignId('source_repository_id')->nullable()->constrained('extension_repositories')->nullOnDelete();
            $table->string('source_repository_name')->nullable();
            $table->text('source_registry_url')->nullable();
            $table->text('source_archive_url')->nullable();
            $table->string('package_checksum', 64)->nullable();
            $table->json('manifest');
            $table->timestamp('installed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('extension_packages');
    }
};