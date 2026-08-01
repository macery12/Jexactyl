<?php

namespace Everest\Services\Billing;

use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;

/**
 * Persists the exact PayPal create-order body before using a stable
 * PayPal-Request-Id, so every ambiguous retry is byte-for-byte equivalent.
 */
class PayPalOrderCreationService
{
    private const LEDGER_KEY = 'paypal_order_create';

    public function __construct(private CheckoutIntegrityService $integrityService)
    {
    }

    public function payload(Order $order, string $returnUrl, string $cancelUrl): array
    {
        /** @var PaymentTransaction $transaction */
        $transaction = PaymentTransaction::query()
            ->where('order_id', $order->id)
            ->firstOrFail();
        $frozen = $this->frozenPayload($order, $transaction);
        if ($frozen !== null) {
            return $frozen;
        }

        $candidate = [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => $this->integrityService->paypalReference($order),
                'description' => (string) $order->product_name,
                'amount' => [
                    'currency_code' => $this->integrityService->currency($order),
                    'value' => $this->integrityService->formattedAmount($order),
                ],
                'custom_id' => json_encode(
                    $this->integrityService->paypalCustomData($order),
                    JSON_THROW_ON_ERROR
                ),
            ]],
            'application_context' => [
                'brand_name' => (string) config('app.name'),
                'landing_page' => 'BILLING',
                'user_action' => 'PAY_NOW',
                'return_url' => $returnUrl,
                'cancel_url' => $cancelUrl,
            ],
        ];

        return DB::transaction(function () use ($order, $candidate): array {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction $lockedTransaction */
            $lockedTransaction = PaymentTransaction::query()
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->firstOrFail();

            $this->assertSamePendingCheckout($order, $lockedOrder);

            $frozen = $this->frozenPayload($lockedOrder, $lockedTransaction);
            if ($frozen !== null) {
                return $frozen;
            }

            $metadata = is_array($lockedTransaction->raw_metadata)
                ? $lockedTransaction->raw_metadata
                : [];
            $metadata[self::LEDGER_KEY] = $candidate;
            $lockedTransaction->forceFill(['raw_metadata' => $metadata])->saveOrFail();

            return $candidate;
        });
    }

    private function frozenPayload(
        Order $order,
        PaymentTransaction $transaction,
    ): ?array {
        $metadata = $transaction->raw_metadata;
        if (!is_array($metadata) || !array_key_exists(self::LEDGER_KEY, $metadata)) {
            return null;
        }

        $payload = $metadata[self::LEDGER_KEY];
        $purchaseUnit = is_array($payload)
            ? ($payload['purchase_units'][0] ?? null)
            : null;
        $applicationContext = is_array($payload)
            ? ($payload['application_context'] ?? null)
            : null;
        if (
            !is_array($payload)
            || ($payload['intent'] ?? null) !== 'CAPTURE'
            || count($payload['purchase_units'] ?? []) !== 1
            || !is_array($purchaseUnit)
            || ($purchaseUnit['reference_id'] ?? null) !== $this->integrityService->paypalReference($order)
            || ($purchaseUnit['description'] ?? null) !== (string) $order->product_name
            || ($purchaseUnit['amount']['currency_code'] ?? null) !== $this->integrityService->currency($order)
            || ($purchaseUnit['amount']['value'] ?? null) !== $this->integrityService->formattedAmount($order)
            || ($purchaseUnit['custom_id'] ?? null) !== json_encode(
                $this->integrityService->paypalCustomData($order),
                JSON_THROW_ON_ERROR
            )
            || !is_array($applicationContext)
            || !is_string($applicationContext['brand_name'] ?? null)
            || ($applicationContext['landing_page'] ?? null) !== 'BILLING'
            || ($applicationContext['user_action'] ?? null) !== 'PAY_NOW'
            || !is_string($applicationContext['return_url'] ?? null)
            || $applicationContext['return_url'] === ''
            || !is_string($applicationContext['cancel_url'] ?? null)
            || $applicationContext['cancel_url'] === ''
        ) {
            throw new DisplayException('The PayPal creation ledger does not match this checkout.');
        }

        return $payload;
    }

    private function assertSamePendingCheckout(Order $expected, Order $locked): void
    {
        if (
            $locked->status !== Order::STATUS_PENDING
            || !hash_equals(
                (string) $expected->checkout_request_fingerprint,
                (string) $locked->checkout_request_fingerprint
            )
            || !hash_equals(
                (string) $expected->checkout_fingerprint,
                (string) $locked->checkout_fingerprint
            )
        ) {
            throw new DisplayException('This checkout can no longer create a PayPal order.');
        }
    }
}
