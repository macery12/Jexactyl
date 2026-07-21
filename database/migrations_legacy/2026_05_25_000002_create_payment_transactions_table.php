<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_transactions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('order_id')->index();
            $table->string('processor');                      // 'stripe', 'paypal', 'free'
            $table->string('external_id')->nullable();        // Stripe intent ID, PayPal order ID
            $table->string('capture_id')->nullable();         // PayPal capture_id / Stripe charge ID
            $table->string('status')->nullable();             // Processor-specific status string
            $table->decimal('amount', 10, 2)->nullable();     // Amount in the processor's currency
            $table->string('currency', 10)->nullable();
            $table->string('payer_id')->nullable();           // PayPal payer_id / Stripe customer_id
            $table->string('payer_email')->nullable();
            $table->string('payment_token')->nullable();      // PayPal redirect token
            $table->json('raw_metadata')->nullable();         // Catch-all for processor-specific fields
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();

            $table->foreign('order_id')->references('id')->on('orders')->cascadeOnDelete();
            $table->index(['processor', 'external_id']);
            $table->index('payment_token');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_transactions');
    }
};
