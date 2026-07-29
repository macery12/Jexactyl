<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\PayPalCaptureService;
use Everest\Services\Billing\CheckoutIntegrityService;

class CheckoutIntegrityServiceTest extends TestCase
{
    private CheckoutIntegrityService $service;

    public function setUp(): void
    {
        parent::setUp();

        config()->set('modules.billing.currency.code', 'USD');
        $this->service = new CheckoutIntegrityService();
    }

    public function testAcceptsExactStripeAndPayPalRepresentations(): void
    {
        [$order, $transaction] = $this->lockedOrder();

        $this->service->assertStripeIntent($order, $transaction, $this->stripeIntent());
        $this->service->assertPayPalOrder($order, $transaction, $this->paypalOrder());

        $this->addToAssertionCount(2);
    }

    public function testRejectsStripeAmountMismatchBeforeFulfillment(): void
    {
        [$order, $transaction] = $this->lockedOrder();
        $intent = $this->stripeIntent();
        $intent->amount = 1;

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('amount does not match');

        $this->service->assertStripeIntent($order, $transaction, $intent);
    }

    public function testRejectsLocalSnapshotTamperingEvenWhenProviderFieldsLookValid(): void
    {
        [$order, $transaction] = $this->lockedOrder();
        $order->total = 0.01;

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('local checkout snapshot has been altered');

        $this->service->assertStripeIntent($order, $transaction, $this->stripeIntent());
    }

    public function testRejectsPayPalCurrencyMismatch(): void
    {
        [$order, $transaction] = $this->lockedOrder();
        $providerOrder = $this->paypalOrder();
        $providerOrder['purchase_units'][0]['amount']['currency_code'] = 'EUR';

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('amount or currency does not match');

        $this->service->assertPayPalOrder($order, $transaction, $providerOrder);
    }

    public function testRejectsIncompletePayPalCaptureBeforeWritingLedger(): void
    {
        [$order, $transaction] = $this->lockedOrder();
        $providerOrder = $this->paypalOrder();
        $providerOrder['purchase_units'][0]['payments']['captures'][0]['status'] = 'PENDING';

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('capture has not completed');

        (new PayPalCaptureService($this->service))->record($order, $transaction, $providerOrder);
    }

    public function testPlanChangeFingerprintBindsServerSourceProductAndQuote(): void
    {
        [$order, $transaction] = $this->lockedOrder();
        $order->forceFill([
            'type' => Order::TYPE_UPG,
            'server_id' => 42,
            'source_product_id' => 2,
            'plan_change_snapshot' => [
                'renewal_date' => '2026-08-28T00:00:00+00:00',
                'current_cycle_minor' => 1000,
                'target_cycle_minor' => 2000,
                'charge_minor' => 500,
            ],
            'checkout_fingerprint' => 'pending',
        ]);
        $fingerprint = new \ReflectionMethod(CheckoutIntegrityService::class, 'fingerprint');
        $order->checkout_fingerprint = $fingerprint->invoke($this->service, $order);

        $intent = $this->stripeIntent();
        $intent->amount = 1999;
        $intent->metadata->checkout_fingerprint = $order->checkout_fingerprint;

        $tamperedSnapshot = $order->plan_change_snapshot;
        $tamperedSnapshot['charge_minor'] = 499;
        $order->plan_change_snapshot = $tamperedSnapshot;

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('local checkout snapshot has been altered');
        $this->service->assertStripeIntent($order, $transaction, $intent);
    }

    /**
     * @return array{Order, PaymentTransaction}
     */
    private function lockedOrder(): array
    {
        $order = new Order();
        $order->forceFill([
            'id' => 71,
            'user_id' => 9,
            'product_id' => 3,
            'type' => Order::TYPE_NEW,
            'coupon_id' => null,
            'egg_id' => 4,
            'node_id' => 5,
            'server_id' => null,
            'billing_days' => 30,
            'name' => 'Immutable server',
            'variables' => [['key' => 'MODE', 'value' => 'safe']],
            'domain_payload' => [],
            'subtotal' => 19.99,
            'discount' => 0,
            'total' => 19.99,
            'checkout_currency' => 'USD',
            'checkout_amount_minor' => 1999,
            'checkout_locked_at' => now(),
            'checkout_fingerprint' => 'pending',
        ]);

        $fingerprint = new \ReflectionMethod(CheckoutIntegrityService::class, 'fingerprint');
        $order->checkout_fingerprint = $fingerprint->invoke($this->service, $order);

        $transaction = new PaymentTransaction();
        $transaction->forceFill([
            'id' => 91,
            'order_id' => $order->id,
            'processor' => 'paypal',
            'external_id' => 'PROVIDER-ORDER-71',
            'provider_customer_id' => 'cus_71',
        ]);

        return [$order, $transaction];
    }

    private function stripeIntent(): object
    {
        return (object) [
            'id' => 'PROVIDER-ORDER-71',
            'amount' => 1999,
            'currency' => 'usd',
            'customer' => 'cus_71',
            'metadata' => (object) [
                'order_id' => '71',
                'product_id' => '3',
                'checkout_fingerprint' => $this->lockedOrder()[0]->checkout_fingerprint,
            ],
        ];
    }

    private function paypalOrder(): array
    {
        [$order] = $this->lockedOrder();

        return [
            'id' => 'PROVIDER-ORDER-71',
            'status' => 'COMPLETED',
            'purchase_units' => [[
                'reference_id' => 'order_71',
                'custom_id' => json_encode([
                    'order_id' => 71,
                    'product_id' => 3,
                    'checkout_fingerprint' => $order->checkout_fingerprint,
                ], JSON_THROW_ON_ERROR),
                'amount' => [
                    'value' => '19.99',
                    'currency_code' => 'USD',
                ],
                'payments' => [
                    'captures' => [[
                        'id' => 'CAPTURE-71',
                        'status' => 'COMPLETED',
                        'amount' => [
                            'value' => '19.99',
                            'currency_code' => 'USD',
                        ],
                        'create_time' => now()->toIso8601String(),
                    ]],
                ],
            ]],
        ];
    }
}
