<?php

namespace Everest\Services\Billing;

use Everest\Models\User;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;

/**
 * Freezes the exact Stripe PaymentIntent create payload before the provider is
 * called. Stripe idempotency keys may only be replayed with identical input.
 */
class StripeIntentCreationService
{
    private const LEDGER_KEY = 'stripe_intent_create';

    public function __construct(
        private StripeCustomerService $customerService,
        private CheckoutIntegrityService $integrityService,
    ) {
    }

    public function parameters(Order $order, User $user): array
    {
        /** @var PaymentTransaction $transaction */
        $transaction = PaymentTransaction::query()
            ->where('order_id', $order->id)
            ->firstOrFail();
        $frozen = $this->frozenParameters($order, $transaction);
        if ($frozen !== null) {
            return $frozen;
        }

        // Customer creation is itself idempotent. Do it outside the database
        // transaction, then race all contenders through the ledger row lock.
        $customerId = $this->customerService->resolveForUser($user);
        $candidate = [
            'amount' => $this->integrityService->minorAmount($order),
            'currency' => strtolower($this->integrityService->currency($order)),
            'payment_method_types' => $this->configuredPaymentMethods(),
            'capture_method' => 'manual',
            'metadata' => $this->integrityService->stripeMetadata($order),
            'customer' => $customerId,
        ];

        return DB::transaction(function () use ($order, $candidate, $customerId): array {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction $lockedTransaction */
            $lockedTransaction = PaymentTransaction::query()
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->firstOrFail();

            $this->assertSamePendingCheckout($order, $lockedOrder);

            $frozen = $this->frozenParameters($lockedOrder, $lockedTransaction);
            if ($frozen !== null) {
                return $frozen;
            }
            if (
                $lockedTransaction->provider_customer_id !== null
                && $lockedTransaction->provider_customer_id !== $customerId
            ) {
                throw new DisplayException('A different Stripe Customer is already bound to this checkout.');
            }

            $metadata = is_array($lockedTransaction->raw_metadata)
                ? $lockedTransaction->raw_metadata
                : [];
            $metadata[self::LEDGER_KEY] = $candidate;
            $lockedTransaction->forceFill([
                'provider_customer_id' => $customerId,
                'raw_metadata' => $metadata,
            ])->saveOrFail();

            return $candidate;
        });
    }

    private function frozenParameters(
        Order $order,
        PaymentTransaction $transaction,
    ): ?array {
        $metadata = $transaction->raw_metadata;
        if (!is_array($metadata) || !array_key_exists(self::LEDGER_KEY, $metadata)) {
            return null;
        }

        $parameters = $metadata[self::LEDGER_KEY];
        if (!is_array($parameters)) {
            throw new DisplayException('The Stripe creation ledger is malformed.');
        }

        $methods = $parameters['payment_method_types'] ?? null;
        if (
            !is_array($methods)
            || $methods === []
            || !in_array('card', $methods, true)
            || count($methods) !== count(array_unique($methods))
        ) {
            throw new DisplayException('The Stripe payment-method ledger is malformed.');
        }
        foreach ($methods as $method) {
            if (!is_string($method) || !in_array($method, ['card', 'paypal', 'link'], true)) {
                throw new DisplayException('The Stripe payment-method ledger is malformed.');
            }
        }

        $customerId = $parameters['customer'] ?? null;
        if (
            !is_string($customerId)
            || $customerId === ''
            || $transaction->provider_customer_id !== $customerId
            || ($parameters['amount'] ?? null) !== $this->integrityService->minorAmount($order)
            || ($parameters['currency'] ?? null) !== strtolower($this->integrityService->currency($order))
            || ($parameters['capture_method'] ?? null) !== 'manual'
            || ($parameters['metadata'] ?? null) !== $this->integrityService->stripeMetadata($order)
        ) {
            throw new DisplayException('The Stripe creation ledger does not match this checkout.');
        }

        return [
            'amount' => $parameters['amount'],
            'currency' => $parameters['currency'],
            'payment_method_types' => array_values($methods),
            'capture_method' => 'manual',
            'metadata' => $parameters['metadata'],
            'customer' => $customerId,
        ];
    }

    private function configuredPaymentMethods(): array
    {
        $methods = ['card'];
        if (config('modules.billing.paypal')) {
            $methods[] = 'paypal';
        }
        if (config('modules.billing.link')) {
            $methods[] = 'link';
        }

        return $methods;
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
            throw new DisplayException('This checkout can no longer create a payment intent.');
        }
    }
}
