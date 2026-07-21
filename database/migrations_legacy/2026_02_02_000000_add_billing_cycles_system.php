<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        /*
         * PRODUCTS
         */
        if (Schema::hasTable('products') && !Schema::hasColumn('products', 'base_price')) {
            Schema::table('products', function (Blueprint $table) {
                $table->decimal('base_price', 10, 2)->nullable()->after('price');
            });
        }

        /*
         * BILLING CYCLES
         */
        if (!Schema::hasTable('billing_cycles')) {
            Schema::create('billing_cycles', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_id')
                    ->constrained('products')
                    ->cascadeOnDelete();
                $table->integer('days');
                $table->boolean('is_enabled')->default(true);
                $table->timestamps();

                $table->unique(['product_id', 'days']);
            });
        }

        /*
         * ORDERS
         */
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                if (!Schema::hasColumn('orders', 'billing_days')) {
                    $table->integer('billing_days')->nullable()->after('product_id');
                }

                if (!Schema::hasColumn('orders', 'final_price')) {
                    $table->decimal('final_price', 10, 2)->nullable()->after('billing_days');
                }

                if (!Schema::hasColumn('orders', 'multiplier_used')) {
                    $table->decimal('multiplier_used', 5, 4)->nullable()->after('final_price');
                }
            });
        }

        /*
         * SERVERS
         */
        if (Schema::hasTable('servers') && !Schema::hasColumn('servers', 'billing_days')) {
            Schema::table('servers', function (Blueprint $table) {
                $table->integer('billing_days')->nullable()->after('billing_product_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('servers') && Schema::hasColumn('servers', 'billing_days')) {
            Schema::table('servers', function (Blueprint $table) {
                $table->dropColumn('billing_days');
            });
        }

        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                $columns = [];

                if (Schema::hasColumn('orders', 'billing_days')) {
                    $columns[] = 'billing_days';
                }
                if (Schema::hasColumn('orders', 'final_price')) {
                    $columns[] = 'final_price';
                }
                if (Schema::hasColumn('orders', 'multiplier_used')) {
                    $columns[] = 'multiplier_used';
                }

                if (!empty($columns)) {
                    $table->dropColumn($columns);
                }
            });
        }

        if (Schema::hasTable('billing_cycles')) {
            Schema::dropIfExists('billing_cycles');
        }

        if (Schema::hasTable('products') && Schema::hasColumn('products', 'base_price')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropColumn('base_price');
            });
        }
    }
};
