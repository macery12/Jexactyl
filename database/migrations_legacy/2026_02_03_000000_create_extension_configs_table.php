<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('extension_configs', function (Blueprint $table) {
            $table->id();
            $table->string('extension_id')->index();
            $table->boolean('enabled')->default(false);
            $table->json('allowed_nests')->nullable();
            $table->json('allowed_eggs')->nullable();
            $table->json('settings')->nullable();
            $table->timestamps();

            $table->unique('extension_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('extension_configs');
    }
};
