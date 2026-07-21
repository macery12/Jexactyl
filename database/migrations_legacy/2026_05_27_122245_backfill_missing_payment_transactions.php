<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill payment_transactions rows that were missed during the dual-write
 * transition window (Phase 5, Step 1).
 *
 * Two categories:
 *
 * A) Real paid orders with NO transaction row at all (found: orders 30, 31, 32, 35).
 *    Fully reconstructed from the orders table columns that still exist.
 *
 * B) Existing Stripe transaction rows that have a valid external_id but NULL
 *    amount / currency / capture_id (found: TX#1,3,4,5 for orders 1,11,12,14).
 *    Amount filled from orders.total, currency from billing config,
 *    status set to "captured" since all are processed orders.
 *
 * Zero-total stripe orders (no PaymentIntent created) are intentionally skipped.
 */
return new class extends Migration
{
    public function up(): void
    {
        $currency = strtolower(config('modules.billing.currency.code', 'usd'));

        // ── A: Insert missing rows ───────────────────────────────────────────

        $missing = DB::table('orders as o')
            ->leftJoin('payment_transactions as pt', 'pt.order_id', '=', 'o.id')
            ->whereNull('pt.id')
            ->whereNotIn('o.payment_processor', ['free', ''])
            ->whereNotNull('o.payment_processor')
            ->where('o.total', '>', 0)
            ->select('o.*')
            ->get();

        foreach ($missing as $order) {
            $processor = strtolower($order->payment_processor);

            if ($processor === 'stripe') {
                if (empty($order->payment_intent_id)) {
                    continue;
                }
                DB::table('payment_transactions')->insert([
                    'order_id'      => $order->id,
                    'processor'     => 'stripe',
                    'external_id'   => $order->payment_intent_id,
                    'capture_id'    => null,
                    'status'        => 'captured',
                    'amount'        => $order->total,
                    'currency'      => $currency,
                    'payment_token' => $order->payment_token ?: null,
                    'captured_at'   => $order->updated_at,
                    'created_at'    => $order->created_at,
                    'updated_at'    => now(),
                ]);
            } elseif ($processor === 'paypal') {
                if (empty($order->paypal_order_id)) {
                    continue;
                }
                DB::table('payment_transactions')->insert([
                    'order_id'      => $order->id,
                    'processor'     => 'paypal',
                    'external_id'   => $order->paypal_order_id,
                    'capture_id'    => $order->paypal_capture_id ?: null,
                    'status'        => $order->paypal_status ?: null,
                    'amount'        => $order->paypal_amount ?: $order->total,
                    'currency'      => $order->paypal_currency ?: strtoupper($currency),
                    'payer_id'      => $order->paypal_payer_id ?: null,
                    'payer_email'   => $order->paypal_payer_email ?: null,
                    'payment_token' => $order->payment_token ?: null,
                    'captured_at'   => $order->paypal_captured_at ?: null,
                    'created_at'    => $order->created_at,
                    'updated_at'    => now(),
                ]);
            }
        }

        // ── B: Fill capture data on existing Stripe rows that are missing it ─

        DB::table('payment_transactions as pt')
            ->join('orders as o', 'o.id', '=', 'pt.order_id')
            ->where('pt.processor', 'stripe')
            ->whereNull('pt.amount')
            ->whereNotNull('pt.external_id')
            ->where('pt.external_id', '!=', '')
            ->select('pt.id', 'o.total')
            ->chunkById(500, function ($transactions) use ($currency) {
                foreach ($transactions as $transaction) {
                    DB::table('payment_transactions')
                        ->where('id', $transaction->id)
                        ->update([
                            'status' => 'captured',
                            'amount' => $transaction->total,
                            'currency' => $currency,
                            'updated_at' => now(),
                        ]);
                }
            }, 'pt.id');
    }

    public function down(): void
    {
        // Intentionally not reversible — deleting backfilled rows risks
        // removing data that may have been updated by production traffic.
    }
};

