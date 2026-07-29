<?php

namespace Everest\Services\Billing;

use Everest\Models\Billing\Order;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;

class CheckoutIntegrityService
{
    private const NON_TWO_DECIMAL_CURRENCIES = [
        'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
        'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
        // PayPal treats HUF and TWD as zero-decimal while Stripe has special
        // two-decimal handling. The shared decimal(…,2) ledger cannot safely
        // represent one canonical value across both processors.
        'HUF', 'TWD',
        'BHD', 'JOD', 'KWD', 'OMR', 'TND',
    ];

    /**
     * Persist a checkout snapshot and make all fulfillment-relevant fields immutable.
     */
    public function lock(Order $order, array $attributes = []): Order
    {
        $order->forceFill($attributes);
        $currency = strtoupper((string) config('modules.billing.currency.code'));
        if (!preg_match('/^[A-Z]{3}$/', $currency)) {
            throw new DisplayException('The configured billing currency is invalid.');
        }
        if (in_array($currency, self::NON_TWO_DECIMAL_CURRENCIES, true)) {
            throw new DisplayException('This billing installation currently supports only two-decimal currencies.');
        }

        $order->checkout_currency = $currency;
        $order->checkout_amount_minor = $this->toMinorUnits((float) $order->total, $currency);
        $order->checkout_fingerprint = $this->fingerprint($order);
        $order->checkout_locked_at = now();
        $order->saveOrFail();

        return $order;
    }

    /**
     * Determine whether a requested snapshot is identical to an already locked order.
     */
    public function matches(Order $order, array $attributes): bool
    {
        if (!$order->checkout_locked_at || !$order->checkout_fingerprint) {
            return false;
        }

        $candidate = clone $order;
        $candidate->forceFill($attributes);

        return hash_equals((string) $order->checkout_fingerprint, $this->fingerprint($candidate));
    }

    /**
     * Assert that a Stripe PaymentIntent is the exact provider representation of an order.
     */
    public function assertStripeIntent(Order $order, PaymentTransaction $transaction, object $intent): void
    {
        $this->assertLocked($order);

        if (($intent->id ?? null) !== $transaction->external_id) {
            throw new DisplayException('The payment intent does not match this checkout.');
        }

        if ((int) ($intent->amount ?? -1) !== $this->minorAmount($order)) {
            throw new DisplayException('The payment amount does not match this checkout.');
        }

        if (strtolower((string) ($intent->currency ?? '')) !== strtolower($this->currency($order))) {
            throw new DisplayException('The payment currency does not match this checkout.');
        }

        $actualCustomer = $intent->customer ?? null;
        if (is_object($actualCustomer)) {
            $actualCustomer = $actualCustomer->id ?? null;
        }

        if (($actualCustomer ?: null) !== ($transaction->provider_customer_id ?: null)) {
            throw new DisplayException('The payment customer does not match this checkout.');
        }

        $metadata = $intent->metadata ?? null;
        if (
            (string) $this->metadataValue($metadata, 'order_id') !== (string) $order->id
            || (string) $this->metadataValue($metadata, 'product_id') !== (string) $order->product_id
            || (string) $this->metadataValue($metadata, 'checkout_fingerprint') !== (string) $order->checkout_fingerprint
        ) {
            throw new DisplayException('The payment reference does not match this checkout.');
        }
    }

    /**
     * Assert that a PayPal order/capture is the exact provider representation of an order.
     */
    public function assertPayPalOrder(Order $order, PaymentTransaction $transaction, array $providerOrder): void
    {
        $this->assertLocked($order);

        if (($providerOrder['id'] ?? null) !== $transaction->external_id) {
            throw new DisplayException('The PayPal order does not match this checkout.');
        }

        $purchaseUnit = $providerOrder['purchase_units'][0] ?? null;
        if (!is_array($purchaseUnit)) {
            throw new DisplayException('The PayPal order is missing purchase information.');
        }

        $amount = $purchaseUnit['amount'] ?? null;
        if (
            !is_array($amount)
            || $this->normalizeMajorAmount($amount['value'] ?? null, $order) !== $this->formattedAmount($order)
            || strtoupper((string) ($amount['currency_code'] ?? '')) !== $this->currency($order)
        ) {
            throw new DisplayException('The PayPal amount or currency does not match this checkout.');
        }

        if (($purchaseUnit['reference_id'] ?? null) !== $this->paypalReference($order)) {
            throw new DisplayException('The PayPal reference does not match this checkout.');
        }

        $customData = json_decode((string) ($purchaseUnit['custom_id'] ?? ''), true);
        if (
            !is_array($customData)
            || (string) ($customData['order_id'] ?? '') !== (string) $order->id
            || (string) ($customData['product_id'] ?? '') !== (string) $order->product_id
            || (string) ($customData['checkout_fingerprint'] ?? '') !== (string) $order->checkout_fingerprint
        ) {
            throw new DisplayException('The PayPal checkout snapshot does not match this order.');
        }
    }

    public function stripeMetadata(Order $order): array
    {
        $this->assertLocked($order);

        return [
            'order_id' => (string) $order->id,
            'product_id' => (string) $order->product_id,
            'checkout_fingerprint' => (string) $order->checkout_fingerprint,
        ];
    }

    public function paypalCustomData(Order $order): array
    {
        $this->assertLocked($order);

        return [
            'order_id' => $order->id,
            'product_id' => $order->product_id,
            'checkout_fingerprint' => (string) $order->checkout_fingerprint,
        ];
    }

    public function paypalReference(Order $order): string
    {
        return 'order_' . $order->id;
    }

    public function minorAmount(Order $order): int
    {
        $this->assertLocked($order);

        return (int) $order->checkout_amount_minor;
    }

    public function formattedAmount(Order $order): string
    {
        return number_format(
            (float) $order->total,
            $this->currencyExponent($this->currency($order)),
            '.',
            ''
        );
    }

    public function currency(Order $order): string
    {
        $this->assertLocked($order);

        return strtoupper((string) $order->checkout_currency);
    }

    private function fingerprint(Order $order): string
    {
        $payload = [
            'order_id' => (int) $order->id,
            'user_id' => (int) $order->user_id,
            'product_id' => (int) $order->product_id,
            'requires_free_product_entitlement' => (bool) $order->requires_free_product_entitlement,
            'type' => (string) $order->type,
            'coupon_id' => $order->coupon_id === null ? null : (int) $order->coupon_id,
            'egg_id' => $order->egg_id === null ? null : (int) $order->egg_id,
            'node_id' => $order->node_id === null ? null : (int) $order->node_id,
            // Renewal and plan-change servers are immutable inputs. A new
            // order's server_id is an output populated only after provisioning.
            'server_id' => in_array($order->type, [Order::TYPE_REN, Order::TYPE_UPG], true)
                && $order->server_id !== null
                ? (int) $order->server_id
                : null,
            'source_product_id' => $order->source_product_id === null
                ? null
                : (int) $order->source_product_id,
            'plan_change_snapshot' => $this->canonicalize($order->plan_change_snapshot ?? []),
            'billing_days' => (int) $order->billing_days,
            'name' => (string) $order->name,
            'variables' => $this->canonicalize($order->variables ?? []),
            'domain_payload' => $this->canonicalize($order->domain_payload ?? []),
            'subtotal' => number_format((float) $order->subtotal, 2, '.', ''),
            'discount' => number_format((float) $order->discount, 2, '.', ''),
            'total' => number_format((float) $order->total, 2, '.', ''),
            'currency' => (string) $order->checkout_currency,
            'amount_minor' => (int) $order->checkout_amount_minor,
        ];

        return hash_hmac(
            'sha256',
            json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            (string) config('app.key')
        );
    }

    private function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        if (!array_is_list($value)) {
            ksort($value);
        }

        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }

    private function metadataValue(mixed $metadata, string $key): mixed
    {
        if (is_array($metadata)) {
            return $metadata[$key] ?? null;
        }

        if (is_object($metadata)) {
            return $metadata->{$key} ?? null;
        }

        return null;
    }

    private function assertLocked(Order $order): void
    {
        if (
            !$order->checkout_locked_at
            || !$order->checkout_fingerprint
            || !$order->checkout_currency
            || $order->checkout_amount_minor === null
        ) {
            throw new DisplayException('This checkout has not been finalized.');
        }

        if (!hash_equals((string) $order->checkout_fingerprint, $this->fingerprint($order))) {
            throw new DisplayException('The local checkout snapshot has been altered.');
        }
    }

    private function normalizeMajorAmount(mixed $amount, Order $order): string
    {
        if (!is_numeric($amount)) {
            return '';
        }

        return number_format(
            (float) $amount,
            $this->currencyExponent($this->currency($order)),
            '.',
            ''
        );
    }

    private function toMinorUnits(float $amount, string $currency): int
    {
        return (int) round($amount * (10 ** $this->currencyExponent($currency)));
    }

    private function currencyExponent(string $currency): int
    {
        return 2;
    }
}
