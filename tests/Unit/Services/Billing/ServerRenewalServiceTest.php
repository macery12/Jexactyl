<?php

namespace Everest\Tests\Unit\Services\Billing;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Servers\SuspensionService;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\ServerRenewalService;

class ServerRenewalServiceTest extends TestCase
{
    private SuspensionService $suspensionService;
    private CreateOrderService $orderService;
    private ServerRenewalService $service;

    public function setUp(): void
    {
        parent::setUp();

        $this->createTables();
        $this->suspensionService = \Mockery::mock(SuspensionService::class);
        $this->suspensionService->shouldNotReceive('toggle');
        $this->orderService = \Mockery::mock(CreateOrderService::class);
        $this->service = new ServerRenewalService($this->suspensionService, $this->orderService);
    }

    public function testPaidRenewalConsumesTheOriginalOrderExactlyOnceWithoutChangingSnapshotName(): void
    {
        [$server, $product] = $this->createServerAndProduct(10.0, now()->addDays(3));
        $order = $this->createOrder($server, $product, [
            'name' => 'immutable-renewal-snapshot',
            'status' => Order::STATUS_FULFILLING,
            'payment_processor' => 'paypal',
            'fulfillment_claim' => '11111111-1111-4111-8111-111111111111',
            'billing_days' => 30,
            'total' => 10,
        ]);
        $this->orderService->shouldNotReceive('create');

        $result = $this->service->renew($server, $product, null, 365, $order);

        $renewedOrder = $result['order']->fresh();
        $renewedServer = $result['server']->fresh();
        $this->assertSame(Order::STATUS_PROCESSED, $renewedOrder->status);
        $this->assertNull($renewedOrder->fulfillment_claim);
        $this->assertSame('immutable-renewal-snapshot', $renewedOrder->name);
        $this->assertSame(30, $renewedServer->billing_days);
        $this->assertTrue($renewedServer->renewal_date->equalTo(now()->addDays(33)));

        $firstRenewalDate = $renewedServer->renewal_date->toDateTimeString();
        try {
            $this->service->renew($renewedServer, $product, null, 30, $renewedOrder);
            $this->fail('A processed paid order must not be reusable.');
        } catch (DisplayException) {
            $this->assertSame(
                $firstRenewalDate,
                Server::query()->findOrFail($server->id)->renewal_date->toDateTimeString()
            );
        }
    }

    public function testFreeProductIgnoresClientSelectedRenewalPeriod(): void
    {
        config()->set('modules.billing.renewal.free_renewal_days', 7);
        [$server, $product] = $this->createServerAndProduct(0.0, now()->subDay());
        $order = $this->createOrder($server, $product, [
            'status' => Order::STATUS_PENDING,
            'payment_processor' => 'free',
            'billing_days' => 7,
            'total' => 0,
        ]);

        $this->orderService->shouldReceive('create')
            ->once()
            ->withArgs(fn (
                mixed $intent,
                mixed $user,
                mixed $createdProduct,
                mixed $status,
                mixed $type,
                mixed $coupon,
                mixed $egg,
                array $attributes,
            ): bool => $intent === null
                && $user->id === $server->owner_id
                && $createdProduct->id === $product->id
                && $status === Order::STATUS_PENDING
                && $type === Order::TYPE_REN
                && $coupon === null
                && $egg === null
                && $attributes['billing_days'] === 7)
            ->andReturn($order);

        $result = $this->service->renew($server, $product, null, 365);

        $this->assertSame(7, $result['server']->fresh()->billing_days);
        $this->assertSame(
            now()->addDays(6)->toDateString(),
            $result['server']->fresh()->renewal_date->toDateString()
        );
        $this->assertSame(Order::STATUS_PROCESSED, $result['order']->fresh()->status);
    }

    public function testRenewalRejectsAProductThatDoesNotOwnTheServer(): void
    {
        [$server] = $this->createServerAndProduct(10.0, now()->addDay());
        DB::table('products')->insert([
            'id' => 2,
            'uuid' => '22222222-2222-4222-8222-222222222222',
            'name' => 'Other product',
            'price' => 20,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherProduct = Product::query()->findOrFail(2);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('does not use this product');

        $this->service->renew($server, $otherProduct, null, 30);
    }

    /**
     * @return array{Server, Product}
     */
    private function createServerAndProduct(float $price, Carbon $renewalDate): array
    {
        DB::table('users')->insert([
            'id' => 1,
            'uuid' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'username' => 'renewal-user',
            'email' => 'renewal@example.test',
            'password' => 'unused',
            'root_admin' => false,
            'use_totp' => false,
            'state' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('products')->insert([
            'id' => 1,
            'uuid' => '11111111-1111-4111-8111-111111111111',
            'name' => 'Renewal product',
            'price' => $price,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('allocations')->insert([
            'id' => 1,
            'node_id' => 1,
            'ip' => '127.0.0.1',
            'port' => 25565,
            'server_id' => 1,
        ]);
        DB::table('servers')->insert([
            'id' => 1,
            'uuid' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'uuidShort' => 'bbbbbbbb',
            'node_id' => 1,
            'name' => 'Renewable server',
            'description' => '',
            'status' => null,
            'skip_scripts' => false,
            'owner_id' => 1,
            'memory' => 1024,
            'swap' => 0,
            'disk' => 1024,
            'io' => 500,
            'cpu' => 100,
            'oom_killer' => false,
            'allocation_id' => 1,
            'nest_id' => 1,
            'egg_id' => 1,
            'startup' => 'start',
            'image' => 'example/image',
            'billing_product_id' => 1,
            'billing_days' => 30,
            'billing_amount' => $price,
            'renewal_date' => $renewalDate,
            'database_limit' => 0,
            'allocation_limit' => 0,
            'backup_limit' => 0,
            'subuser_limit' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            Server::query()->findOrFail(1),
            Product::query()->findOrFail(1),
        ];
    }

    private function createOrder(Server $server, Product $product, array $overrides): Order
    {
        $defaults = [
            'name' => 'renewal-order',
            'user_id' => $server->owner_id,
            'description' => 'Renewal order',
            'total' => $product->price,
            'subtotal' => $product->price,
            'discount' => 0,
            'status' => Order::STATUS_PENDING,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'billing_days' => 30,
            'server_id' => $server->id,
            'payment_processor' => 'free',
            'type' => Order::TYPE_REN,
            'threat_index' => -1,
            'created_at' => now(),
            'updated_at' => now(),
        ];
        $id = DB::table('orders')->insertGetId(array_merge($defaults, $overrides));

        return Order::query()->findOrFail($id);
    }

    private function createTables(): void
    {
        foreach (['orders', 'servers', 'allocations', 'eggs', 'nests', 'nodes', 'products', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('users', function (Blueprint $table): void {
            $table->increments('id');
            $table->uuid('uuid');
            $table->string('username');
            $table->string('email');
            $table->text('password')->nullable();
            $table->boolean('root_admin')->default(false);
            $table->boolean('use_totp')->default(false);
            $table->string('state')->nullable();
            $table->timestamps();
        });
        Schema::create('products', function (Blueprint $table): void {
            $table->increments('id');
            $table->uuid('uuid');
            $table->string('name');
            $table->decimal('price', 10, 2);
            $table->timestamps();
        });
        Schema::create('nodes', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('nests', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('eggs', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('allocations', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('node_id');
            $table->string('ip');
            $table->unsignedInteger('port');
            $table->unsignedInteger('server_id')->nullable();
            $table->string('notes')->nullable();
        });
        Schema::create('servers', function (Blueprint $table): void {
            $table->increments('id');
            $table->uuid('uuid');
            $table->string('uuidShort');
            $table->unsignedInteger('node_id');
            $table->string('name');
            $table->string('description');
            $table->string('status')->nullable();
            $table->boolean('skip_scripts');
            $table->unsignedInteger('owner_id');
            $table->unsignedInteger('memory');
            $table->integer('swap');
            $table->unsignedInteger('disk');
            $table->unsignedInteger('io');
            $table->unsignedInteger('cpu');
            $table->string('threads')->nullable();
            $table->boolean('oom_killer');
            $table->unsignedInteger('allocation_id');
            $table->unsignedInteger('nest_id');
            $table->unsignedInteger('egg_id');
            $table->string('startup')->nullable();
            $table->string('image');
            $table->unsignedInteger('billing_product_id')->nullable();
            $table->unsignedBigInteger('billing_order_id')->nullable();
            $table->unsignedInteger('billing_days')->nullable();
            $table->decimal('billing_amount', 10, 2)->nullable();
            $table->timestamp('renewal_date')->nullable();
            $table->timestamp('deletion_scheduled_at')->nullable();
            $table->unsignedInteger('database_limit')->nullable();
            $table->unsignedInteger('allocation_limit')->nullable();
            $table->unsignedInteger('backup_limit')->default(0);
            $table->integer('subuser_limit')->default(0);
            $table->unsignedInteger('subdomain_limit')->nullable();
            $table->timestamps();
        });
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
            $table->string('payment_processor');
            $table->string('type');
            $table->integer('threat_index')->default(-1);
            $table->unsignedBigInteger('coupon_id')->nullable();
            $table->uuid('fulfillment_claim')->nullable();
            $table->timestamps();
        });

        DB::table('nodes')->insert(['id' => 1]);
        DB::table('nests')->insert(['id' => 1]);
        DB::table('eggs')->insert(['id' => 1]);
    }

    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }
}
