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
use Everest\Services\Billing\CreateServerService;
use Everest\Services\Billing\OrderProcessorService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

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
        $fulfillment->shouldReceive('fulfillOrder')
            ->once()
            ->with(
                \Mockery::type(Request::class),
                \Mockery::on(function (Order $order) {
                    return $order->id === 11 && $order->payment_intent_id === 'pi-match';
                }),
                \Mockery::type('object')
            )
            ->andReturn(\Mockery::mock(\Everest\Models\Server::class));

        $settings = \Mockery::mock(SettingsRepositoryInterface::class);
        $settings->shouldReceive('get')
            ->once()
            ->with('settings::modules:billing:keys:secret', \Mockery::any())
            ->andReturn(null);
        $this->app->instance(SettingsRepositoryInterface::class, $settings);

        $invoiceSettings = \Mockery::mock(\Everest\Services\Billing\InvoiceSettingsService::class);
        $invoiceSettings->shouldReceive('get')
            ->once()
            ->andReturn(new InvoiceSettings(['require_billing_address' => false]));

        $controller = new \Everest\Http\Controllers\Api\Client\Billing\CheckoutController(
            $validation,
            \Mockery::mock(OrderProcessorService::class),
            \Mockery::mock(CreateOrderService::class),
            \Mockery::mock(CreateServerService::class),
            $fulfillment,
            \Mockery::mock(\Everest\Services\Billing\StripeCustomerService::class),
            $invoiceSettings
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

        $request = Request::create('/api/client/billing/process', 'POST', ['intent' => 'pi-match']);
        $request->setUserResolver(function () {
            $user = new User();
            $user->id = 7;

            return $user;
        });

        $response = $controller->processPaid($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }
}
