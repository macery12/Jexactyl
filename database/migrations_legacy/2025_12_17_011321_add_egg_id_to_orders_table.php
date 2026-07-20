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
        Schema::table('orders', function (Blueprint $table) {
            // Track which egg was selected during checkout
            $table->unsignedInteger('egg_id')->nullable()->after('product_id');
            $table->foreign('egg_id')->references('id')->on('eggs')->onDelete('set null');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['egg_id']);
            $table->dropColumn('egg_id');
        });
    }
};
