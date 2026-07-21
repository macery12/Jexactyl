<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Migrate existing processor-specific data from the orders table into
     * payment_transactions. This migration is additive — it does NOT drop any
     * columns from orders; see phase-5-data-model.md for the dual-write rollout plan.
     *
     * Run in a transaction so a partial failure leaves orders untouched.
     */
    public function up(): void
    {
        DB::transaction(function () {
            $now = now();

            // Stripe orders
            DB::table('orders')
                ->where('payment_processor', 'stripe')
                ->whereNotNull('payment_intent_id')
                ->chunkById(500, function ($orders) use ($now) {
                    $rows = $orders->map(fn($o) => [
                        'order_id'    => $o->id,
                        'processor'   => 'stripe',
                        'external_id' => $o->payment_intent_id,
                        'status'      => $o->status ?? null,
                        'created_at'  => $o->created_at ?? $now,
                        'updated_at'  => $now,
                    ])->toArray();

                    DB::table('payment_transactions')->insertOrIgnore($rows);
                });

            // PayPal orders
            DB::table('orders')
                ->where('payment_processor', 'paypal')
                ->whereNotNull('paypal_order_id')
                ->chunkById(500, function ($orders) use ($now) {
                    $rows = $orders->map(fn($o) => [
                        'order_id'      => $o->id,
                        'processor'     => 'paypal',
                        'external_id'   => $o->paypal_order_id,
                        'capture_id'    => $o->paypal_capture_id ?? null,
                        'status'        => $o->paypal_status ?? null,
                        'amount'        => $o->paypal_amount ?? null,
                        'currency'      => $o->paypal_currency ?? null,
                        'payer_id'      => $o->paypal_payer_id ?? null,
                        'payer_email'   => $o->paypal_payer_email ?? null,
                        'payment_token' => $o->payment_token ?? null,
                        'captured_at'   => $o->paypal_captured_at ?? null,
                        'created_at'    => $o->created_at ?? $now,
                        'updated_at'    => $now,
                    ])->toArray();

                    DB::table('payment_transactions')->insertOrIgnore($rows);
                });
        });
    }

    public function down(): void
    {
        DB::table('payment_transactions')->delete();
    }
};
