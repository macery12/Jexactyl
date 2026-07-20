<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('curseforge_request_logs');
    }

    public function down(): void
    {
        Schema::create('curseforge_request_logs', function ($table) {
            $table->id();
            $table->timestamp('requested_at');
            $table->string('endpoint');
            $table->integer('status_code');
            $table->index('requested_at');
        });
    }
};
