<?php

namespace Everest\Services\Billing;

use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\PaymentTransaction;

class PayPalNegativeEventService
{
    public function __construct(private CheckoutReservationService $reservationService)
    {
    }

    /**
     * Persist signed negative financial truth without allowing a concurrent
     * capture or fulfillment worker to overwrite it.
     *
     * @return array{order_status: string, requires_reconciliation: bool}
     */
    public function record(
        Order $order,
        PaymentTransaction $transaction,
        string $eventType,
        string $transmissionId,
    ): array {
        $negativeStatus = strtolower(str_replace('PAYMENT.CAPTURE.', '', $eventType));

        [$orderStatus, $requiresReconciliation] = DB::transaction(
            function () use (
                $order,
                $transaction,
                $eventType,
                $transmissionId,
                $negativeStatus,
            ): array {
                /** @var Order $lockedOrder */
                $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
                /** @var PaymentTransaction $lockedTransaction */
                $lockedTransaction = PaymentTransaction::query()
                    ->whereKey($transaction->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $originalStatus = $lockedOrder->status;
                $releaseReservation = false;
                $requiresReconciliation = in_array($originalStatus, [
                    Order::STATUS_FULFILLING,
                    Order::STATUS_PAYMENT_REVIEW,
                    Order::STATUS_PROCESSED,
                ], true);

                if ($originalStatus === Order::STATUS_PENDING) {
                    $lockedOrder->forceFill(['status' => Order::STATUS_FAILED])->saveOrFail();
                    $releaseReservation = true;
                } elseif ($originalStatus === Order::STATUS_FULFILLING) {
                    // Fence the active claim before it can cross the next
                    // transaction-protected entitlement boundary.
                    $lockedOrder->forceFill(['status' => Order::STATUS_PAYMENT_REVIEW])->saveOrFail();
                }

                $events = $lockedTransaction->provider_negative_events ?? [];
                $events[$transmissionId] = [
                    'event_type' => $eventType,
                    'status' => $negativeStatus,
                    'recorded_at' => now()->toIso8601String(),
                ];
                $lockedTransaction->forceFill([
                    'status' => ($lockedTransaction->capture_id || $lockedTransaction->captured_at)
                        ? $negativeStatus . '_review'
                        : $negativeStatus,
                    'provider_negative_status' => $negativeStatus,
                    'provider_negative_at' => now(),
                    'provider_negative_events' => $events,
                ])->saveOrFail();

                if ($releaseReservation) {
                    $this->reservationService->releaseLocked($lockedOrder, $lockedTransaction);
                }

                return [
                    $lockedOrder->fresh()->status,
                    $requiresReconciliation,
                ];
            }
        );

        return [
            'order_status' => $orderStatus,
            'requires_reconciliation' => $requiresReconciliation,
        ];
    }
}
