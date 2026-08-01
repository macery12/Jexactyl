<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('source_product_id')->nullable()->after('product_id');
            $table->json('plan_change_snapshot')->nullable()->after('domain_payload');
            $table->foreign('source_product_id', 'orders_source_product_foreign')
                ->references('id')
                ->on('products')
                ->nullOnDelete();
            $table->index(
                ['server_id', 'type', 'status'],
                'orders_plan_change_conflict_index'
            );
        });

        Schema::table('servers', function (Blueprint $table) {
            $table->unsignedBigInteger('pending_plan_change_order_id')->nullable()->after('billing_order_id');
            $table->unsignedBigInteger('scheduled_billing_product_id')->nullable()->after('billing_product_id');
            $table->timestamp('scheduled_plan_change_at')->nullable()->after('scheduled_billing_product_id');
            $table->json('scheduled_plan_change_snapshot')->nullable()->after('scheduled_plan_change_at');
            $table->timestamp('scheduled_plan_change_retry_at')->nullable()->after('scheduled_plan_change_snapshot');
            $table->text('scheduled_plan_change_last_error')->nullable()->after('scheduled_plan_change_retry_at');

            $table->unique('pending_plan_change_order_id', 'servers_pending_plan_change_order_unique');
            $table->index('scheduled_plan_change_at', 'servers_scheduled_plan_change_at_index');
            $table->index('scheduled_plan_change_retry_at', 'servers_scheduled_plan_change_retry_at_index');
            $table->foreign('pending_plan_change_order_id', 'servers_pending_plan_change_order_foreign')
                ->references('id')
                ->on('orders')
                ->nullOnDelete();
            $table->foreign('scheduled_billing_product_id', 'servers_scheduled_billing_product_foreign')
                ->references('id')
                ->on('products');
        });
    }

    public function down(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            $table->dropForeign('servers_scheduled_billing_product_foreign');
            $table->dropForeign('servers_pending_plan_change_order_foreign');
            $table->dropIndex('servers_scheduled_plan_change_at_index');
            $table->dropIndex('servers_scheduled_plan_change_retry_at_index');
            $table->dropUnique('servers_pending_plan_change_order_unique');
            $table->dropColumn([
                'pending_plan_change_order_id',
                'scheduled_billing_product_id',
                'scheduled_plan_change_at',
                'scheduled_plan_change_snapshot',
                'scheduled_plan_change_retry_at',
                'scheduled_plan_change_last_error',
            ]);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign('orders_source_product_foreign');
            $table->dropIndex('orders_plan_change_conflict_index');
            $table->dropColumn(['source_product_id', 'plan_change_snapshot']);
        });
    }
};
