<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Orders, coupon usage and the normalized payment ledger. orders keeps its
 * legacy checkout columns (payment_intent_id, paypal_*) alongside
 * payment_transactions — still actively used (docs/database-rebuild/04 D3).
 * orders.total is double for legacy reasons (D6). billing_exceptions.order_id
 * is int unsigned with no FK, matching the historical chain.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('name');
            $table->unsignedInteger('user_id')->index();
            $table->string('description');
            $table->double('total');
            $table->decimal('subtotal', 10, 2)->nullable();
            $table->decimal('discount', 10, 2)->nullable();
            $table->string('status');
            $table->unsignedInteger('product_id');
            $table->string('product_name')->nullable();
            $table->integer('billing_days')->nullable();
            $table->decimal('final_price', 10, 2)->nullable();
            $table->decimal('multiplier_used', 5, 4)->nullable();
            $table->decimal('node_multiplier_used', 5, 2)->nullable();
            $table->unsignedInteger('egg_id')->nullable();
            $table->integer('node_id')->nullable();
            $table->integer('server_id')->nullable();
            $table->json('variables')->nullable();
            $table->json('domain_payload')->nullable();
            $table->unsignedBigInteger('coupon_id')->nullable();
            $table->timestamps();
            $table->string('payment_intent_id')->nullable();
            $table->string('payment_processor')->default('stripe');
            $table->string('paypal_order_id')->nullable()->index();
            $table->string('paypal_capture_id')->nullable();
            $table->string('paypal_payer_id')->nullable();
            $table->string('paypal_payer_email')->nullable();
            $table->string('paypal_status')->nullable();
            $table->decimal('paypal_amount', 10, 2)->nullable();
            $table->string('paypal_currency', 3)->nullable();
            $table->timestamp('paypal_captured_at')->nullable();
            $table->string('payment_token')->nullable()->index();
            $table->integer('threat_index')->default(-1);
            $table->string('type')->nullable();

            $table->foreign('egg_id')->references('id')->on('eggs')->onDelete('set null');
            $table->foreign('coupon_id')->references('id')->on('coupons')->onDelete('set null');
        });

        Schema::create('coupon_usage', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('coupon_id');
            $table->unsignedInteger('user_id');
            $table->unsignedBigInteger('order_id');
            $table->dateTime('used_at');
            $table->timestamps();

            $table->foreign('coupon_id')->references('id')->on('coupons')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('order_id')->references('id')->on('orders')->onDelete('cascade');
        });

        Schema::create('payment_transactions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('order_id')->index();
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->string('capture_id')->nullable();
            $table->string('status')->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->nullable();
            $table->string('payer_id')->nullable();
            $table->string('payer_email')->nullable();
            $table->string('payment_token')->nullable()->index();
            $table->json('raw_metadata')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();

            $table->index(['processor', 'external_id']);
            $table->foreign('order_id')->references('id')->on('orders')->onDelete('cascade');
        });

        Schema::create('billing_exceptions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36);
            $table->unsignedInteger('order_id')->nullable();
            $table->text('title');
            $table->text('description');
            $table->string('exception_type');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_exceptions');
        Schema::dropIfExists('payment_transactions');
        Schema::dropIfExists('coupon_usage');
        Schema::dropIfExists('orders');
    }
};
