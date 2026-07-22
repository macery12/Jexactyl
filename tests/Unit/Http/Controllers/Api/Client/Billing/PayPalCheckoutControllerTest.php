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
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\ServerFulfillmentService;
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
        Schema::create('products', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name')->nullable();
            $table->timestamps();
        });

        DB::table('products')->insert([
            'id' => 123,
            'name' => 'Test Product',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
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
        $validation->shouldReceive('calculatePriceWithCoupon')
            ->once()
            ->with(
                \Mockery::on(fn (Product $candidate) => $candidate->id === 123),
                77,
                'new',
                10,
                null,
                42
            )
            ->andReturn([
                'finalPrice' => 19.99,
                'subtotal' => 19.99,
                'discount' => 0,
            ]);
        $validation->shouldReceive('validatePriceType')
            ->once()
            ->with(19.99, false);

        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldReceive('createOrder')
            ->once()
            ->with(
                \Mockery::on(fn (Product $candidate) => $candidate->id === 123),
                19.99,
                77,
                \Mockery::type('string'),
                \Mockery::type('string')
            )
            ->andReturn([
                'id' => 'PAYPAL-ORDER-123',
                'links' => [
                    ['rel' => 'approve', 'href' => 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-123'],
                ],
            ]);
        $paypalService->shouldReceive('getApprovalUrl')
            ->once()
            ->andReturn('https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-123');

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
                0
            );

        $controller = new PayPalCheckoutController(
            $paypalService,
            $validation,
            $orderService,
            \Mockery::mock(ServerFulfillmentService::class)
        );

        $user = new User();
        $user->id = 42;

        $request = Request::create('/api/client/billing/products/123/paypal/order', 'POST', [
            'coupon_id' => 77,
            'billing_days' => 10,
            'return_url' => 'https://panel.example/account/billing/processing',
        ]);
        $request->setUserResolver(fn () => $user);

        $response = $controller->createOrder($request, 123);

        $this->assertSame(200, $response->getStatusCode());
    }
}
