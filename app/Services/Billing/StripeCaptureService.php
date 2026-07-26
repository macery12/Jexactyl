<?php

namespace Everest\Services\Billing;

use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;

class StripeCaptureService
{
    public function __construct(private CheckoutIntegrityService $integrityService)
    {
    }

    public function record(
        Order $order,
        PaymentTransaction $transaction,
        object $capturedIntent,
    ): void {
        $this->integrityService->assertStripeIntent($order, $transaction, $capturedIntent);
        if (($capturedIntent->status ?? null) !== 'succeeded') {
            throw new DisplayException('Stripe did not confirm that this payment was captured.');
        }
        if (
            !isset($capturedIntent->amount_received)
            || (int) $capturedIntent->amount_received !== $this->integrityService->minorAmount($order)
        ) {
            throw new DisplayException('The captured Stripe amount does not match this checkout.');
        }

        $captureId = $capturedIntent->latest_charge ?? null;
        if (is_object($captureId)) {
            $captureId = $captureId->id ?? null;
        }

        DB::transaction(function () use ($transaction, $captureId, $order): void {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction $lockedTransaction */
            $lockedTransaction = PaymentTransaction::query()
                ->whereKey($transaction->id)
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->firstOrFail();
            if (
                $lockedTransaction->capture_id !== null
                && $lockedTransaction->capture_id !== $captureId
            ) {
                throw new DisplayException('A different Stripe capture is already bound to this order.');
            }

            $lockedTransaction->forceFill([
                'status' => 'captured',
                'capture_id' => $captureId,
                'amount' => $this->integrityService->formattedAmount($lockedOrder),
                'currency' => strtolower($this->integrityService->currency($lockedOrder)),
                'captured_at' => $lockedTransaction->captured_at ?? now(),
            ])->saveOrFail();
        });
    }
}
