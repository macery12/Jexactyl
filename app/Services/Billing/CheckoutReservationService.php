<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\CouponUsage;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Models\Billing\FreeProductEntitlement;

class CheckoutReservationService
{
    public function consume(Order $order, ?Server $server = null): void
    {
        CouponUsage::query()
            ->where('order_id', $order->id)
            ->where('status', 'reserved')
            ->update([
                'status' => 'consumed',
                'expires_at' => null,
                'used_at' => now(),
            ]);

        FreeProductEntitlement::query()
            ->where('order_id', $order->id)
            ->where('status', 'reserved')
            ->update([
                'status' => 'consumed',
                'server_id' => $server?->id,
                'expires_at' => null,
            ]);
    }

    public function release(Order $order): void
    {
        DB::transaction(function () use ($order): void {
            /** @var Order|null $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->first();
            if ($locked === null) {
                return;
            }

            $transaction = $locked->transaction()->lockForUpdate()->first();
            $this->releaseLocked($locked, $transaction);
        });
    }

    /**
     * Atomically move an unfulfilled order to a terminal state and release its
     * reservations. A caller never observes the terminal state without the
     * matching coupon/free-entitlement release.
     */
    public function transitionAndRelease(
        Order $order,
        string $expectedStatus,
        string $terminalStatus,
        ?string $expectedClaim = null,
        ?string $transactionStatus = null,
    ): bool {
        return DB::transaction(function () use (
            $order,
            $expectedStatus,
            $terminalStatus,
            $expectedClaim,
            $transactionStatus,
        ): bool {
            /** @var Order|null $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->first();
            if ($locked === null || $locked->status !== $expectedStatus) {
                return false;
            }
            if (
                $expectedClaim !== null
                && !hash_equals((string) $expectedClaim, (string) $locked->fulfillment_claim)
            ) {
                return false;
            }

            /** @var PaymentTransaction|null $transaction */
            $transaction = $locked->transaction()->lockForUpdate()->first();
            if (
                (
                    !in_array($locked->type, [Order::TYPE_REN, Order::TYPE_UPG], true)
                    && $locked->server_id !== null
                )
                || $transaction?->capture_id
                || $transaction?->captured_at
            ) {
                return false;
            }

            $locked->forceFill([
                'status' => $terminalStatus,
                'fulfillment_claim' => null,
            ])->saveOrFail();
            if ($transaction !== null && $transactionStatus !== null) {
                $transaction->forceFill(['status' => $transactionStatus])->saveOrFail();
            }

            return $this->releaseLocked($locked, $transaction);
        });
    }

    /**
     * Release reservations while the order and transaction rows are already
     * locked by the caller's transaction.
     */
    public function releaseLocked(
        Order $locked,
        ?PaymentTransaction $transaction = null,
    ): bool {
        if (
            !in_array($locked->status, [
                Order::STATUS_FAILED,
                Order::STATUS_CANCELLED,
                Order::STATUS_EXPIRED,
            ], true)
            || (
                !in_array($locked->type, [Order::TYPE_REN, Order::TYPE_UPG], true)
                && $locked->server_id !== null
            )
            || $transaction?->capture_id
            || $transaction?->captured_at
        ) {
            return false;
        }

        if ($locked->type === Order::TYPE_UPG && $locked->server_id !== null) {
            Server::query()
                ->whereKey($locked->server_id)
                ->where('pending_plan_change_order_id', $locked->id)
                ->update(['pending_plan_change_order_id' => null]);
        }

        CouponUsage::query()
            ->where('order_id', $locked->id)
            ->where('status', 'reserved')
            ->delete();
        FreeProductEntitlement::query()
            ->where('order_id', $locked->id)
            ->where('status', 'reserved')
            ->delete();

        return true;
    }
}
