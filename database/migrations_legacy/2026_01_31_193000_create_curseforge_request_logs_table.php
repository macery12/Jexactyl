<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('curseforge_request_logs', function (Blueprint $table) {
            $table->id();
            $table->timestamp('requested_at')->useCurrent();
            $table->string('endpoint', 255);
            $table->integer('status_code')->default(200);
            $table->index('requested_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('curseforge_request_logs');
    }
};
