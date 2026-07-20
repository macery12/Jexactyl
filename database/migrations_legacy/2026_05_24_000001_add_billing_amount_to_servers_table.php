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
        if (Schema::hasTable('servers') && !Schema::hasColumn('servers', 'billing_amount')) {
            Schema::table('servers', function (Blueprint $table) {
                $table->decimal('billing_amount', 10, 2)->nullable()->after('billing_days');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('servers') && Schema::hasColumn('servers', 'billing_amount')) {
            Schema::table('servers', function (Blueprint $table) {
                $table->dropColumn('billing_amount');
            });
        }
    }
};
