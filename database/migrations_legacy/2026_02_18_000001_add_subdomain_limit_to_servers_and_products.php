<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            if (!Schema::hasColumn('servers', 'subdomain_limit')) {
                $table->unsignedInteger('subdomain_limit')->nullable()->default(1)->after('subuser_limit');
            }
        });

        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'subdomain_limit')) {
                $table->unsignedInteger('subdomain_limit')->nullable()->default(1)->after('allocation_limit');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            if (Schema::hasColumn('servers', 'subdomain_limit')) {
                $table->dropColumn('subdomain_limit');
            }
        });

        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'subdomain_limit')) {
                $table->dropColumn('subdomain_limit');
            }
        });
    }
};
