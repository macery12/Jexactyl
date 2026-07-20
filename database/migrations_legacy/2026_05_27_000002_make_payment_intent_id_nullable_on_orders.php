<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Phase 5.5 — Remove the synthetic "free-{uuid}" value from payment_intent_id
     * for free orders and make the column nullable.
     *
     * Free orders don't have a real Stripe PaymentIntent, so storing a fake value
     * under a unique-constrained column was a workaround. Now that PaymentTransaction
     * is the authoritative payment record, free orders simply leave payment_intent_id null.
     */
    public function up(): void
    {
        // Null out the synthetic free-order placeholders before altering the column
        DB::table('orders')
            ->where('payment_intent_id', 'like', 'free-%')
            ->update(['payment_intent_id' => null]);

        Schema::table('orders', function (Blueprint $table) {
            $table->string('payment_intent_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        // Restore a synthetic value so the NOT NULL constraint can be re-added
        DB::table('orders')
            ->where('payment_processor', 'free')
            ->whereNull('payment_intent_id')
            ->chunkById(500, function ($orders) {
                foreach ($orders as $order) {
                    DB::table('orders')->where('id', $order->id)->update([
                        'payment_intent_id' => 'free-' . substr((string) \Illuminate\Support\Str::uuid(), 0, 16),
                    ]);
                }
            });

        Schema::table('orders', function (Blueprint $table) {
            $table->string('payment_intent_id')->nullable(false)->change();
        });
    }
};
