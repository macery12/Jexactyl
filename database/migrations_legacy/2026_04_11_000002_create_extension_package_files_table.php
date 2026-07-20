<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('extension_package_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('extension_package_id')->constrained('extension_packages')->cascadeOnDelete();
            $table->string('path')->unique();
            $table->string('operation');
            $table->string('installed_checksum', 64);
            $table->text('backup_path')->nullable();
            $table->string('backup_checksum', 64)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('extension_package_files');
    }
};