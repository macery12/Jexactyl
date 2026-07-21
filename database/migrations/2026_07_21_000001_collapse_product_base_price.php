<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/**
 * Collapse `products.base_price` into `products.price`.
 *
 * The two columns were doing contradictory jobs. The admin UI described
 * base_price as a struck-through "original price", and the landing page
 * rendered it that way — but BillingCycleService billed from
 * `base_price ?? price`, so a product advertised at 8.00 → 5.00 actually
 * charged 8.00. One price now means one price.
 *
 * The collapse preserves what customers were ACTUALLY charged (the effective
 * base price), not the advertised number, so nobody's bill changes on deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('products')
            ->whereNotNull('base_price')
            ->update(['price' => DB::raw('base_price')]);

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('base_price');
        });
    }

    public function down(): void
    {
        // The column comes back empty: post-collapse there is no stored
        // distinction between the billing basis and a display price, so
        // re-splitting them would be invention rather than a restore.
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('base_price', 10, 2)->nullable()->after('price');
        });
    }
};
