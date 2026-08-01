<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Client\Billing;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Models\Billing\InvoiceSettings;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\StripeCaptureService;
use Everest\Services\Billing\OrderProcessorService;
use Everest\Services\Billing\InvoiceSettingsService;
use Everest\Services\Billing\CheckoutSnapshotService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\StripeIntentCreationService;
use Everest\Contracts\Repository\SettingsRepositoryInterface;
use Everest\Http\Requests\Api\Client\Billing\UpdateCheckoutRequest;

class CheckoutControllerTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'checkout_controller_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database for checkout controller test.');
        }
        $this->dbPath = $dbPath;

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::dropIfExists('orders');
        Schema::dropIfExists('payment_transactions');
        Schema::create('orders', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('payment_intent_id')->unique();
            $table->string('status');
            $table->timestamps();
        });

        Schema::create('payment_transactions', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('order_id');
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->string('provider_customer_id')->nullable();
            $table->string('capture_id')->nullable();
            $table->string('status')->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();
        });
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testProcessPaidBindsFulfillmentToMatchingUserIntentOrder(): void
    {
        $now = now();

        DB::table('orders')->insert([
            [
                'id' => 11,
                'user_id' => 7,
                'payment_intent_id' => 'pi-match',
                'status' => Order::STATUS_PENDING,
                'created_at' => $now->copy()->subMinute(),
                'updated_at' => $now->copy()->subMinute(),
            ],
            [
                'id' => 12,
                'user_id' => 7,
                'payment_intent_id' => 'pi-newer',
                'status' => Order::STATUS_PENDING,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        DB::table('payment_transactions')->insert([
            'order_id' => 11,
            'processor' => 'stripe',
            'external_id' => 'pi-match',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $validation = \Mockery::mock(BillingValidationService::class);
        $validation->shouldReceive('validateBillingEnabled')->once();

        $fulfillment = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillment->shouldReceive('fulfillStripeOrder')
            ->once()
            ->with(
                \Mockery::type(Request::class),
                \Mockery::on(function (Order $order) {
                    return $order->id === 11 && $order->payment_intent_id === 'pi-match';
                }),
                \Mockery::type('callable'),
                false
            )
            ->andReturn(\Mockery::mock(\Everest\Models\Server::class));

        $settings = \Mockery::mock(SettingsRepositoryInterface::class);
        $settings->shouldReceive('get')
            ->once()
            ->with('settings::modules:billing:keys:secret', \Mockery::any())
            ->andReturn(null);
        $this->app->instance(SettingsRepositoryInterface::class, $settings);

        $invoiceSettings = \Mockery::mock(InvoiceSettingsService::class);
        $invoiceSettings->shouldReceive('get')
            ->once()
            ->andReturn(new InvoiceSettings(['require_billing_address' => false]));

        $integrity = \Mockery::mock(CheckoutIntegrityService::class);
        $integrity->shouldReceive('assertStripeIntent')
            ->once()
            ->with(
                \Mockery::on(fn (Order $order) => $order->id === 11),
                \Mockery::on(fn ($transaction) => $transaction->external_id === 'pi-match'),
                \Mockery::type('object')
            );

        $controller = new \Everest\Http\Controllers\Api\Client\Billing\CheckoutController(
            $validation,
            \Mockery::mock(OrderProcessorService::class),
            \Mockery::mock(CreateOrderService::class),
            $fulfillment,
            \Mockery::mock(StripeIntentCreationService::class),
            $invoiceSettings,
            \Mockery::mock(CheckoutSnapshotService::class),
            $integrity,
            \Mockery::mock(StripeCaptureService::class),
        );

        $intent = new class () {
            public string $id = 'pi-match';
            public string $status = 'requires_capture';
            public object $metadata;

            public function __construct()
            {
                $this->metadata = (object) ['server_id' => 1];
            }

            public function capture(): void
            {
            }
        };

        $stripe = \Mockery::mock(\Stripe\StripeClient::class);
        $stripe->paymentIntents = new class ($intent) {
            public function __construct(private object $intent)
            {
            }

            public function retrieve(string $intentId): object
            {
                return $this->intent;
            }
        };

        $reflection = new \ReflectionProperty($controller, 'stripe');
        $reflection->setAccessible(true);
        $reflection->setValue($controller, $stripe);

        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/process',
            'POST',
            ['intent' => 'pi-match']
        );
        $request->setUserResolver(function () {
            $user = new User();
            $user->id = 7;

            return $user;
        });

        $response = $controller->processPaid($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }

    public function testAlreadyCapturedIntentRecordsLedgerThroughFulfillmentCallback(): void
    {
        $now = now();
        DB::table('orders')->insert([
            'id' => 21,
            'user_id' => 7,
            'payment_intent_id' => 'pi-captured',
            'status' => Order::STATUS_PENDING,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('payment_transactions')->insert([
            'id' => 31,
            'order_id' => 21,
            'processor' => 'stripe',
            'external_id' => 'pi-captured',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $validation = \Mockery::mock(BillingValidationService::class);
        $validation->shouldReceive('validateBillingEnabled')->once();
        $integrity = \Mockery::mock(CheckoutIntegrityService::class);
        $integrity->shouldReceive('assertStripeIntent')->twice();
        $integrity->shouldReceive('minorAmount')->once()->andReturn(1999);
        $integrity->shouldReceive('formattedAmount')->once()->andReturn('19.99');
        $integrity->shouldReceive('currency')->once()->andReturn('USD');

        $fulfillment = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillment->shouldReceive('fulfillStripeOrder')
            ->once()
            ->with(
                \Mockery::type(Request::class),
                \Mockery::on(fn (Order $order) => $order->id === 21),
                \Mockery::type('callable'),
                true,
            )
            ->andReturnUsing(function (
                Request $request,
                Order $order,
                callable $recordCapture,
                bool $providerAlreadyCaptured,
            ) {
                $this->assertTrue($providerAlreadyCaptured);
                $recordCapture();

                return \Mockery::mock(\Everest\Models\Server::class);
            });

        $settings = \Mockery::mock(SettingsRepositoryInterface::class);
        $settings->shouldReceive('get')
            ->once()
            ->with('settings::modules:billing:keys:secret', \Mockery::any())
            ->andReturn(null);
        $this->app->instance(SettingsRepositoryInterface::class, $settings);

        $invoiceSettings = \Mockery::mock(InvoiceSettingsService::class);
        $invoiceSettings->shouldReceive('get')
            ->once()
            ->andReturn(new InvoiceSettings(['require_billing_address' => false]));

        $controller = new \Everest\Http\Controllers\Api\Client\Billing\CheckoutController(
            $validation,
            \Mockery::mock(OrderProcessorService::class),
            \Mockery::mock(CreateOrderService::class),
            $fulfillment,
            \Mockery::mock(StripeIntentCreationService::class),
            $invoiceSettings,
            \Mockery::mock(CheckoutSnapshotService::class),
            $integrity,
            new StripeCaptureService($integrity),
        );

        $intent = new class () {
            public string $id = 'pi-captured';
            public string $status = 'succeeded';
            public int $amount_received = 1999;
            public string $latest_charge = 'ch-captured';
        };
        $stripe = \Mockery::mock(\Stripe\StripeClient::class);
        $stripe->paymentIntents = new class ($intent) {
            public function __construct(private object $intent)
            {
            }

            public function retrieve(string $intentId): object
            {
                return $this->intent;
            }
        };
        $reflection = new \ReflectionProperty($controller, 'stripe');
        $reflection->setValue($controller, $stripe);

        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/process',
            'POST',
            ['intent' => 'pi-captured']
        );
        $request->setUserResolver(function () {
            $user = new User();
            $user->id = 7;

            return $user;
        });

        $response = $controller->processPaid($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
        $this->assertDatabaseHas('payment_transactions', [
            'id' => 31,
            'status' => 'captured',
            'capture_id' => 'ch-captured',
            'amount' => 19.99,
            'currency' => 'usd',
        ]);
        $this->assertNotNull(
            DB::table('payment_transactions')->where('id', 31)->value('captured_at')
        );
    }
}
