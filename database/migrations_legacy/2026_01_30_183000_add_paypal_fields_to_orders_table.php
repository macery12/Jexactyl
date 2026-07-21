<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'paypal_order_id')) {
                $table->string('paypal_order_id')->nullable()->after('payment_processor');
            }

            if (!Schema::hasColumn('orders', 'paypal_capture_id')) {
                $table->string('paypal_capture_id')->nullable()->after('paypal_order_id');
            }

            if (!Schema::hasColumn('orders', 'paypal_payer_id')) {
                $table->string('paypal_payer_id')->nullable()->after('paypal_capture_id');
            }

            if (!Schema::hasColumn('orders', 'paypal_payer_email')) {
                $table->string('paypal_payer_email')->nullable()->after('paypal_payer_id');
            }

            if (!Schema::hasColumn('orders', 'paypal_status')) {
                $table->string('paypal_status')->nullable()->after('paypal_payer_email');
            }

            if (!Schema::hasColumn('orders', 'paypal_amount')) {
                $table->decimal('paypal_amount', 10, 2)->nullable()->after('paypal_status');
            }

            if (!Schema::hasColumn('orders', 'paypal_currency')) {
                $table->string('paypal_currency', 3)->nullable()->after('paypal_amount');
            }

            if (!Schema::hasColumn('orders', 'paypal_captured_at')) {
                $table->timestamp('paypal_captured_at')->nullable()->after('paypal_currency');
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'paypal_order_id',
                'paypal_capture_id',
                'paypal_payer_id',
                'paypal_payer_email',
                'paypal_status',
                'paypal_amount',
                'paypal_currency',
                'paypal_captured_at',
            ]);
        });
    }
};
