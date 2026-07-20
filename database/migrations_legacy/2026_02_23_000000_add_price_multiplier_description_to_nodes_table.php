<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasColumn('nodes', 'price_multiplier_description')) {
            Schema::table('nodes', function (Blueprint $table) {
                $table->string('price_multiplier_description', 500)->nullable()->after('price_multiplier');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasColumn('nodes', 'price_multiplier_description')) {
            Schema::table('nodes', function (Blueprint $table) {
                $table->dropColumn('price_multiplier_description');
            });
        }
    }
};
