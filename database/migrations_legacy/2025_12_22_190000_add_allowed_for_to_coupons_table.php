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
        if (Schema::hasTable('coupons') && !Schema::hasColumn('coupons', 'allowed_for')) {
            $hasIsActive = Schema::hasColumn('coupons', 'is_active');

            Schema::table('coupons', function (Blueprint $table) use ($hasIsActive) {
                $column = $table->enum('allowed_for', ['both', 'purchases', 'renewals'])->default('both');

                if ($hasIsActive) {
                    $column->after('is_active');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('coupons') && Schema::hasColumn('coupons', 'allowed_for')) {
            Schema::table('coupons', function (Blueprint $table) {
                $table->dropColumn('allowed_for');
            });
        }
    }
};
