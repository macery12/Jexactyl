<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\PlanChangeService;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\CreateServerService;
use Everest\Services\Billing\OrderProcessorService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\CheckoutReservationService;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

class ServerFulfillmentServiceTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'server_fulfillment_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create fulfillment test database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('orders', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('payment_processor');
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('capture_id')->nullable();
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

    public function testGenericEntryPointRejectsUncapturedProviderOrder(): void
    {
        DB::table('orders')->insert([
            'id' => 1,
            'payment_processor' => 'stripe',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('payment_transactions')->insert([
            'order_id' => 1,
            'processor' => 'stripe',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $service = new ServerFulfillmentService(
            \Mockery::mock(CreateServerService::class),
            \Mockery::mock(OrderProcessorService::class),
            \Mockery::mock(CustomDomainProvisioningService::class),
            \Mockery::mock(CreateOrderService::class),
            \Mockery::mock(CheckoutReservationService::class),
            \Mockery::mock(PlanChangeService::class),
        );

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('durable capture evidence');
        $service->fulfillOrder(
            Request::create('/fulfill', 'POST'),
            Order::query()->findOrFail(1),
        );
    }
}
