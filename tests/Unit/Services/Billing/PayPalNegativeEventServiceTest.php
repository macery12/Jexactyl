<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\PayPalCaptureService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\CheckoutReservationService;
use Everest\Services\Billing\PayPalNegativeEventService;

class PayPalNegativeEventServiceTest extends TestCase
{
    private PayPalNegativeEventService $service;

    public function setUp(): void
    {
        parent::setUp();

        $this->createTables();
        $this->service = new PayPalNegativeEventService(new CheckoutReservationService());
    }

    public function testNegativeEventBeforeClaimFailsOrderAndReleasesReservation(): void
    {
        [$order, $transaction] = $this->createOrder(Order::STATUS_PENDING);

        $result = $this->service->record(
            $order,
            $transaction,
            'PAYMENT.CAPTURE.DENIED',
            'transmission-denied',
        );

        $transaction->refresh();
        $this->assertSame(Order::STATUS_FAILED, $order->fresh()->status);
        $this->assertFalse($result['requires_reconciliation']);
        $this->assertSame('denied', $transaction->provider_negative_status);
        $this->assertArrayHasKey('transmission-denied', $transaction->provider_negative_events);
        $this->assertSame(0, DB::table('coupon_usage')->where('order_id', $order->id)->count());
    }

    public function testNegativeEventDuringFulfillmentFencesClaimAndPreservesReservation(): void
    {
        [$order, $transaction] = $this->createOrder(Order::STATUS_FULFILLING);

        $result = $this->service->record(
            $order,
            $transaction,
            'PAYMENT.CAPTURE.REFUNDED',
            'transmission-refunded',
        );

        $order->refresh();
        $this->assertSame(Order::STATUS_PAYMENT_REVIEW, $order->status);
        $this->assertSame('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $order->fulfillment_claim);
        $this->assertTrue($result['requires_reconciliation']);
        $this->assertSame(1, DB::table('coupon_usage')->where('order_id', $order->id)->count());
    }

    public function testNegativeEventAfterProcessingPreservesEntitlementAndFlagsReview(): void
    {
        [$order, $transaction] = $this->createOrder(Order::STATUS_PROCESSED);

        $result = $this->service->record(
            $order,
            $transaction,
            'PAYMENT.CAPTURE.REVERSED',
            'transmission-reversed',
        );

        $this->assertSame(Order::STATUS_PROCESSED, $order->fresh()->status);
        $this->assertTrue($result['requires_reconciliation']);
        $this->assertSame('reversed', $transaction->fresh()->provider_negative_status);
    }

    public function testCaptureCannotErasePreviouslyObservedNegativeFinancialState(): void
    {
        [$order, $transaction] = $this->createOrder(Order::STATUS_FULFILLING);
        $this->service->record(
            $order,
            $transaction,
            'PAYMENT.CAPTURE.REFUNDED',
            'transmission-race',
        );

        $integrity = \Mockery::mock(CheckoutIntegrityService::class);
        $integrity->shouldReceive('assertPayPalOrder')->once();
        $integrity->shouldReceive('formattedAmount')->times(2)->andReturn('19.99');
        $integrity->shouldReceive('currency')->once()->andReturn('USD');
        $capture = new PayPalCaptureService($integrity);
        $capture->record($order, $transaction, [
            'payer' => ['payer_id' => 'PAYER-1', 'email_address' => 'payer@example.test'],
            'purchase_units' => [[
                'payments' => ['captures' => [[
                    'id' => 'CAPTURE-1',
                    'status' => 'COMPLETED',
                    'amount' => ['value' => '19.99', 'currency_code' => 'USD'],
                    'create_time' => now()->toIso8601String(),
                ]]],
            ]],
        ]);

        $transaction->refresh();
        $this->assertSame('captured_review', $transaction->status);
        $this->assertSame('refunded', $transaction->provider_negative_status);
        $this->assertArrayHasKey('transmission-race', $transaction->provider_negative_events);
    }

    public function testTerminalTransitionRollsBackWhenReservationReleaseFails(): void
    {
        [$order] = $this->createOrder(Order::STATUS_PENDING);
        DB::statement(
            'CREATE TRIGGER fail_coupon_release BEFORE DELETE ON coupon_usage '
            . "BEGIN SELECT RAISE(ABORT, 'injected release failure'); END"
        );

        try {
            (new CheckoutReservationService())->transitionAndRelease(
                $order,
                Order::STATUS_PENDING,
                Order::STATUS_FAILED,
                null,
                'failed',
            );
            $this->fail('The injected reservation failure should abort the transaction.');
        } catch (QueryException) {
            $this->assertSame(Order::STATUS_PENDING, $order->fresh()->status);
            $this->assertSame(
                1,
                DB::table('coupon_usage')->where('order_id', $order->id)->count()
            );
        }
    }

    /**
     * @return array{Order, PaymentTransaction}
     */
    private function createOrder(string $status): array
    {
        $orderId = DB::table('orders')->insertGetId([
            'name' => 'immutable-order',
            'user_id' => 1,
            'description' => 'PayPal order',
            'total' => 19.99,
            'subtotal' => 19.99,
            'discount' => 0,
            'status' => $status,
            'product_id' => 1,
            'product_name' => 'Product',
            'billing_days' => 30,
            'coupon_id' => 1,
            'payment_processor' => 'paypal',
            'type' => Order::TYPE_NEW,
            'threat_index' => -1,
            'fulfillment_claim' => $status === Order::STATUS_FULFILLING
                ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $transactionId = DB::table('payment_transactions')->insertGetId([
            'order_id' => $orderId,
            'processor' => 'paypal',
            'external_id' => 'PAYPAL-ORDER-' . $orderId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('coupon_usage')->insert([
            'coupon_id' => 1,
            'user_id' => 1,
            'order_id' => $orderId,
            'status' => 'reserved',
            'used_at' => now(),
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            Order::query()->findOrFail($orderId),
            PaymentTransaction::query()->findOrFail($transactionId),
        ];
    }

    private function createTables(): void
    {
        foreach ([
            'free_product_entitlements',
            'coupon_usage',
            'payment_transactions',
            'orders',
            'coupons',
            'products',
            'users',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('users', fn (Blueprint $table) => $table->increments('id'));
        Schema::create('products', fn (Blueprint $table) => $table->increments('id'));
        Schema::create('coupons', fn (Blueprint $table) => $table->bigIncrements('id'));
        Schema::create('orders', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('name');
            $table->unsignedInteger('user_id');
            $table->string('description');
            $table->decimal('total', 10, 2);
            $table->decimal('subtotal', 10, 2)->nullable();
            $table->decimal('discount', 10, 2)->nullable();
            $table->string('status');
            $table->unsignedInteger('product_id');
            $table->string('product_name')->nullable();
            $table->integer('billing_days')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedBigInteger('coupon_id')->nullable();
            $table->string('payment_processor');
            $table->string('type');
            $table->integer('threat_index')->default(-1);
            $table->uuid('fulfillment_claim')->nullable();
            $table->string('paypal_capture_id')->nullable();
            $table->string('paypal_status')->nullable();
            $table->decimal('paypal_amount', 10, 2)->nullable();
            $table->string('paypal_currency', 3)->nullable();
            $table->timestamp('paypal_captured_at')->nullable();
            $table->string('paypal_payer_id')->nullable();
            $table->string('paypal_payer_email')->nullable();
            $table->json('domain_payload')->nullable();
            $table->string('payment_intent_id')->nullable();
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->string('capture_id')->nullable();
            $table->string('status')->nullable();
            $table->string('provider_negative_status')->nullable();
            $table->timestamp('provider_negative_at')->nullable();
            $table->json('provider_negative_events')->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->nullable();
            $table->string('payer_id')->nullable();
            $table->string('payer_email')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();
        });
        Schema::create('coupon_usage', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('coupon_id');
            $table->unsignedInteger('user_id');
            $table->unsignedBigInteger('order_id');
            $table->string('status');
            $table->timestamp('used_at');
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
        Schema::create('free_product_entitlements', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('order_id')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->string('status');
            $table->timestamps();
        });

        DB::table('users')->insert(['id' => 1]);
        DB::table('products')->insert(['id' => 1]);
        DB::table('coupons')->insert(['id' => 1]);
    }

    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }
}
