<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('paypal_webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('transmission_id')->unique();
            $table->char('payload_hash', 64);
            $table->string('status', 20)->default('processing');
            $table->unsignedInteger('attempts')->default(1);
            $table->text('last_error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        if (
            (Schema::hasTable('paypal_webhook_events')
                && DB::table('paypal_webhook_events')->exists())
            || DB::table('orders')->where('payment_processor', '!=', 'free')->exists()
            || DB::table('payment_transactions')->where('processor', '!=', 'free')->exists()
        ) {
            throw new RuntimeException('The PayPal webhook ledger is forward-only once provider-backed billing data or webhook evidence exists. Roll back application code without rolling back this additive schema.');
        }

        Schema::dropIfExists('paypal_webhook_events');
    }
};
