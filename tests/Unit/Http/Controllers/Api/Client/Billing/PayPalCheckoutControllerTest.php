<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Client\Billing;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Models\Billing\InvoiceSettings;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\PayPalCaptureService;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\InvoiceSettingsService;
use Everest\Services\Billing\CheckoutSnapshotService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\CheckoutReservationService;
use Everest\Services\Billing\PayPalOrderCreationService;
use Everest\Http\Requests\Api\Client\Billing\UpdateCheckoutRequest;
use Everest\Http\Controllers\Api\Client\Billing\PayPalCheckoutController;

class PayPalCheckoutControllerTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'paypal_checkout_controller_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database for PayPal checkout controller test.');
        }
        $this->dbPath = $dbPath;

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::dropIfExists('products');
        Schema::dropIfExists('orders');
        Schema::dropIfExists('payment_transactions');
        Schema::dropIfExists('coupons');
        Schema::dropIfExists('users');
        Schema::create('users', function (Blueprint $table) {
            $table->increments('id');
        });
        Schema::create('coupons', function (Blueprint $table) {
            $table->bigIncrements('id');
        });
        Schema::create('products', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name')->nullable();
            $table->timestamps();
        });
        Schema::create('orders', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('product_id');
            $table->string('description');
            $table->decimal('subtotal', 10, 2)->nullable();
            $table->decimal('discount', 10, 2)->nullable();
            $table->string('status');
            $table->string('type');
            $table->unsignedInteger('coupon_id')->nullable();
            $table->integer('egg_id')->nullable();
            $table->integer('node_id')->nullable();
            $table->integer('server_id')->nullable();
            $table->integer('billing_days')->nullable();
            $table->string('name');
            $table->decimal('total', 10, 2);
            $table->string('payment_processor');
            $table->uuid('checkout_nonce')->nullable();
            $table->string('checkout_request_fingerprint', 64)->nullable();
            $table->string('payment_intent_id')->nullable();
            $table->string('payment_token')->nullable();
            $table->string('paypal_order_id')->nullable();
            $table->string('checkout_currency', 3)->nullable();
            $table->unsignedBigInteger('checkout_amount_minor')->nullable();
            $table->string('checkout_fingerprint', 64)->nullable();
            $table->timestamp('checkout_locked_at')->nullable();
            $table->json('domain_payload')->nullable();
            $table->integer('threat_index')->default(-1);
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->string('payment_token')->nullable();
            $table->json('raw_metadata')->nullable();
            $table->timestamps();
        });

        DB::table('products')->insert([
            'id' => 123,
            'name' => 'Test Product',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('users')->insert(['id' => 42]);
        DB::table('coupons')->insert(['id' => 77]);
    }

    protected function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testCreateOrderUsesRequestedBillingDaysForPricingAndOrderCreation(): void
    {
        $product = Product::findOrFail(123);

        $validation = \Mockery::mock(BillingValidationService::class);
        $validation->shouldReceive('validateBillingEnabled')->once();
        $validation->shouldReceive('validatePriceType')
            ->once()
            ->with(19.99, false);

        $snapshot = [
            'attributes' => [
                'type' => Order::TYPE_NEW,
                'coupon_id' => 77,
                'egg_id' => null,
                'node_id' => 9,
                'server_id' => null,
                'billing_days' => 10,
                'name' => 'Locked server',
                'variables' => [],
                'domain_payload' => [],
                'multiplier_used' => 1,
                'node_multiplier_used' => 1,
            ],
            'price' => [
                'finalPrice' => 19.99,
                'subtotal' => 19.99,
                'discount' => 0,
            ],
        ];
        $snapshotService = \Mockery::mock(CheckoutSnapshotService::class);
        $snapshotService->shouldReceive('requestFingerprint')
            ->once()
            ->andReturn(str_repeat('b', 64));
        $snapshotService->shouldReceive('existingForRequest')
            ->once()
            ->andReturnNull();
        $snapshotService->shouldReceive('resolve')->once()->andReturn($snapshot);

        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldReceive('createOrder')
            ->once()
            ->with(['frozen' => 'payload'], 'checkout-order-1')
            ->andReturn([
                'id' => 'PAYPAL-ORDER-123',
                'links' => [
                    ['rel' => 'approve', 'href' => 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-123'],
                ],
            ]);
        $paypalService->shouldReceive('getApprovalUrl')
            ->once()
            ->andReturn('https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-123');

        DB::table('orders')->insert([
            'id' => 1,
            'user_id' => 42,
            'product_id' => 123,
            'description' => 'Immutable checkout',
            'subtotal' => 19.99,
            'discount' => 0,
            'status' => Order::STATUS_PENDING,
            'type' => Order::TYPE_NEW,
            'coupon_id' => 77,
            'node_id' => 9,
            'billing_days' => 10,
            'name' => 'Locked server',
            'total' => 19.99,
            'payment_processor' => 'paypal',
            'checkout_request_fingerprint' => str_repeat('b', 64),
            'threat_index' => -1,
            'payment_token' => 'local-token',
            'checkout_currency' => 'USD',
            'checkout_amount_minor' => 1999,
            'checkout_fingerprint' => str_repeat('a', 64),
            'checkout_locked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('payment_transactions')->insert([
            'order_id' => 1,
            'processor' => 'paypal',
            'payment_token' => 'local-token',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $order = Order::query()->findOrFail(1);

        $orderService = \Mockery::mock(CreateOrderService::class);
        $orderService->shouldReceive('create')
            ->once()
            ->with(
                null,
                \Mockery::on(fn ($user) => $user->id === 42),
                \Mockery::on(fn (Product $candidate) => $candidate->id === 123),
                Order::STATUS_PENDING,
                Order::TYPE_NEW,
                77,
                null,
                \Mockery::on(fn (array $data) => ($data['billing_days'] ?? null) === 10),
                19.99,
                19.99,
                0,
                \Mockery::type('callable')
            )
            ->andReturnUsing(function (...$arguments) use ($order): Order {
                $arguments[11]($order);

                return $order;
            })
        ;
        $snapshotService->shouldReceive('lock')
            ->once()
            ->with(\Mockery::on(fn (Order $candidate) => $candidate->id === 1), $snapshot)
            ->andReturn($order);

        $integrity = \Mockery::mock(CheckoutIntegrityService::class);
        $integrity->shouldReceive('assertPayPalOrder')->once();
        $creation = \Mockery::mock(PayPalOrderCreationService::class);
        $creation->shouldReceive('payload')
            ->once()
            ->with(
                \Mockery::on(fn (Order $candidate) => $candidate->id === 1),
                \Mockery::on(fn (string $url) => $url !== ''),
                \Mockery::on(fn (string $url) => $url !== ''),
            )
            ->andReturn(['frozen' => 'payload']);

        $invoiceSettings = \Mockery::mock(InvoiceSettingsService::class);
        $invoiceSettings->shouldReceive('get')
            ->once()
            ->andReturn(new InvoiceSettings(['require_billing_address' => false]));

        $reservationService = \Mockery::mock(CheckoutReservationService::class);
        $reservationService->shouldReceive('transitionAndRelease')->zeroOrMoreTimes();

        $controller = new PayPalCheckoutController(
            $paypalService,
            $validation,
            $orderService,
            \Mockery::mock(ServerFulfillmentService::class),
            $snapshotService,
            $integrity,
            \Mockery::mock(PayPalCaptureService::class),
            $invoiceSettings,
            $reservationService,
            $creation,
        );

        $user = new User();
        $user->id = 42;

        $request = UpdateCheckoutRequest::create('/api/client/billing/products/123/paypal/order', 'POST', [
            'coupon_id' => 77,
            'billing_days' => 10,
            'return_url' => 'https://panel.example/account/billing/processing',
        ]);
        $request->setUserResolver(fn () => $user);

        $response = $controller->createOrder($request, 123);

        $this->assertSame(200, $response->getStatusCode());
    }

    public function testCancelledOrderCannotRedirectBackToProviderApproval(): void
    {
        DB::table('orders')->insert([
            'id' => 2,
            'user_id' => 42,
            'product_id' => 123,
            'description' => 'Cancelled checkout',
            'status' => Order::STATUS_CANCELLED,
            'type' => Order::TYPE_NEW,
            'name' => 'Cancelled server',
            'total' => 19.99,
            'payment_processor' => 'paypal',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('payment_transactions')->insert([
            'order_id' => 2,
            'processor' => 'paypal',
            'external_id' => 'PAYPAL-CANCELLED',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $paypal = \Mockery::mock(PayPalPaymentService::class);
        $paypal->shouldNotReceive('getOrder');
        $controller = new PayPalCheckoutController(
            $paypal,
            \Mockery::mock(BillingValidationService::class),
            \Mockery::mock(CreateOrderService::class),
            \Mockery::mock(ServerFulfillmentService::class),
            \Mockery::mock(CheckoutSnapshotService::class),
            \Mockery::mock(CheckoutIntegrityService::class),
            \Mockery::mock(PayPalCaptureService::class),
            \Mockery::mock(InvoiceSettingsService::class),
            \Mockery::mock(CheckoutReservationService::class),
            \Mockery::mock(PayPalOrderCreationService::class),
        );
        $request = Request::create('/api/client/billing/paypal/PAYPAL-CANCELLED/redirect');
        $request->setUserResolver(function (): User {
            $user = new User();
            $user->id = 42;

            return $user;
        });

        $this->expectException(\Everest\Exceptions\DisplayException::class);
        $this->expectExceptionMessage('no longer pending');

        $controller->redirectToApproval($request, 'PAYPAL-CANCELLED');
    }
}
