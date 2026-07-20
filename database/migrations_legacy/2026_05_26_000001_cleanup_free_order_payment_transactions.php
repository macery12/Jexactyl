<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Remove any payment_transactions rows that were incorrectly inserted for
     * free orders. These rows have an external_id beginning with 'free-', which
     * is the synthetic prefix CreateOrderService writes into orders.payment_intent_id
     * when no real payment intent exists (total = $0).
     *
     * Only real payment processor identifiers (Stripe pi_*, PayPal IDs)
     * should appear in this table.
     */
    public function up(): void
    {
        DB::table('payment_transactions')
            ->where('external_id', 'like', 'free-%')
            ->delete();
    }

    public function down(): void
    {
        // These rows are invalid data — there is nothing to restore on rollback.
    }
};
