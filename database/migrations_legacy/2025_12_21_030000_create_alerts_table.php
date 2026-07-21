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
        Schema::create('alerts', function (Blueprint $table) {
            $table->id();
            $table->string('title')->nullable();
            $table->text('content');
            $table->string('type')->default('info'); // success, info, warning, danger
            $table->string('position')->default('top-center'); // top-center, bottom-right, bottom-left, center
            $table->boolean('enabled')->default(true);
            $table->boolean('dismissible')->default(false);
            $table->string('link')->nullable();
            $table->string('link_text')->nullable();
            $table->integer('priority')->default(0); // Higher priority shows first
            $table->timestamp('start_at')->nullable();
            $table->timestamp('end_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('alerts');
    }
};
