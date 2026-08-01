<?php

namespace Everest\Services\Billing;

use Carbon\Carbon;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;

class PayPalCaptureService
{
    public function __construct(
        private CheckoutIntegrityService $integrityService,
    ) {
    }

    /**
     * Reconcile and atomically bind one unique PayPal capture to one local order.
     */
    public function record(
        Order $order,
        PaymentTransaction $transaction,
        array $providerOrder,
    ): void {
        $this->integrityService->assertPayPalOrder($order, $transaction, $providerOrder);

        $purchaseUnit = $providerOrder['purchase_units'][0] ?? null;
        $capture = is_array($purchaseUnit) ? ($purchaseUnit['payments']['captures'][0] ?? null) : null;
        if (!is_array($capture) || empty($capture['id'])) {
            throw new DisplayException('The completed PayPal order is missing its capture identifier.');
        }

        if (($capture['status'] ?? null) !== 'COMPLETED') {
            throw new DisplayException('The PayPal capture has not completed.');
        }

        $captureAmount = number_format(
            (float) ($capture['amount']['value'] ?? -1),
            strlen(substr(strrchr($this->integrityService->formattedAmount($order), '.') ?: '', 1)),
            '.',
            ''
        );
        $captureCurrency = strtoupper((string) ($capture['amount']['currency_code'] ?? ''));
        if (
            $captureAmount !== $this->integrityService->formattedAmount($order)
            || $captureCurrency !== $this->integrityService->currency($order)
        ) {
            throw new DisplayException('The captured PayPal amount or currency does not match this checkout.');
        }

        $payer = $providerOrder['payer'] ?? [];
        $capturedAt = isset($capture['create_time'])
            ? Carbon::parse($capture['create_time'])
            : now();

        DB::transaction(function () use (
            $order,
            $transaction,
            $capture,
            $captureAmount,
            $captureCurrency,
            $payer,
            $capturedAt,
        ): void {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction $lockedTransaction */
            $lockedTransaction = PaymentTransaction::query()
                ->whereKey($transaction->id)
                ->lockForUpdate()
                ->firstOrFail();

            if (
                $lockedTransaction->capture_id !== null
                && $lockedTransaction->capture_id !== $capture['id']
            ) {
                throw new DisplayException('A different PayPal capture is already bound to this order.');
            }

            $lockedOrder->forceFill([
                'paypal_capture_id' => $capture['id'],
                'paypal_status' => $capture['status'],
                'paypal_amount' => $captureAmount,
                'paypal_currency' => $captureCurrency,
                'paypal_captured_at' => $capturedAt,
                'paypal_payer_id' => $payer['payer_id'] ?? null,
                'paypal_payer_email' => $payer['email_address'] ?? null,
            ])->saveOrFail();

            $lockedTransaction->forceFill([
                // Never erase a refund/reversal/denial observed by a signed
                // webhook, even if completion and negative events arrive out
                // of order.
                'status' => $lockedTransaction->provider_negative_status === null
                    ? $capture['status']
                    : 'captured_review',
                'capture_id' => $capture['id'],
                'amount' => $captureAmount,
                'currency' => $captureCurrency,
                'payer_id' => $payer['payer_id'] ?? null,
                'payer_email' => $payer['email_address'] ?? null,
                'captured_at' => $capturedAt,
            ])->saveOrFail();
        });

        $order->refresh();
        $transaction->refresh();
    }
}
