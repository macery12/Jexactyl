<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        $this->assertNoDuplicatePaymentIdentifiers('external_id');
        $this->assertNoDuplicatePaymentIdentifiers('capture_id');

        if (
            DB::table('payment_transactions')
                ->select('order_id')
                ->groupBy('order_id')
                ->havingRaw('COUNT(*) > 1')
                ->limit(1)
                ->first() !== null
        ) {
            throw new RuntimeException('Cannot harden payment transactions: more than one transaction exists for an order. Reconcile the duplicate rows before applying this migration.');
        }

        Schema::table('orders', function (Blueprint $table) {
            $table->uuid('checkout_nonce')->nullable()->after('payment_processor');
            $table->char('checkout_request_fingerprint', 64)->nullable()->after('checkout_nonce');
            $table->char('checkout_fingerprint', 64)->nullable()->after('payment_token');
            $table->char('checkout_currency', 3)->nullable()->after('checkout_fingerprint');
            $table->unsignedBigInteger('checkout_amount_minor')->nullable()->after('checkout_currency');
            $table->timestamp('checkout_locked_at')->nullable()->after('checkout_fingerprint');
            $table->timestamp('fulfillment_started_at')->nullable()->after('checkout_locked_at');
            $table->uuid('fulfillment_claim')->nullable()->after('fulfillment_started_at');
            $table->unique(
                ['user_id', 'checkout_nonce'],
                'orders_checkout_nonce_unique'
            );
        });

        Schema::table('servers', function (Blueprint $table) {
            $table->unsignedBigInteger('billing_order_id')->nullable()->after('billing_product_id');
            $table->unique('billing_order_id', 'servers_billing_order_unique');
            $table->foreign('billing_order_id', 'servers_billing_order_foreign')
                ->references('id')
                ->on('orders')
                ->nullOnDelete();
        });

        Schema::table('payment_transactions', function (Blueprint $table) {
            $table->string('provider_customer_id')->nullable()->after('external_id');
            $table->string('provider_negative_status', 50)->nullable()->after('status');
            $table->timestamp('provider_negative_at')->nullable()->after('provider_negative_status');
            $table->json('provider_negative_events')->nullable()->after('provider_negative_at');
            $table->unique('order_id', 'payment_transactions_order_unique');
            $table->unique(['processor', 'external_id'], 'payment_transactions_provider_order_unique');
            $table->unique(['processor', 'capture_id'], 'payment_transactions_provider_capture_unique');
        });
    }

    public function down(): void
    {
        Schema::table('payment_transactions', function (Blueprint $table) {
            $table->dropUnique('payment_transactions_provider_capture_unique');
            $table->dropUnique('payment_transactions_provider_order_unique');
            $table->dropUnique('payment_transactions_order_unique');
            $table->dropColumn([
                'provider_customer_id',
                'provider_negative_status',
                'provider_negative_at',
                'provider_negative_events',
            ]);
        });

        Schema::table('servers', function (Blueprint $table) {
            $table->dropForeign('servers_billing_order_foreign');
            $table->dropUnique('servers_billing_order_unique');
            $table->dropColumn('billing_order_id');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropUnique('orders_checkout_nonce_unique');
            $table->dropColumn([
                'checkout_nonce',
                'checkout_request_fingerprint',
                'checkout_fingerprint',
                'checkout_currency',
                'checkout_amount_minor',
                'checkout_locked_at',
                'fulfillment_started_at',
                'fulfillment_claim',
            ]);
        });
    }

    private function assertNoDuplicatePaymentIdentifiers(string $column): void
    {
        $duplicate = DB::table('payment_transactions')
            ->select(['processor', $column])
            ->whereNotNull($column)
            ->groupBy('processor', $column)
            ->havingRaw('COUNT(*) > 1')
            ->limit(1)
            ->first();

        if ($duplicate !== null) {
            throw new RuntimeException(sprintf('Cannot harden payment transactions: duplicate non-null %s values exist for a provider. Reconcile the duplicate rows before applying this migration.', $column));
        }
    }
};
