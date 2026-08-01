<?php

namespace Everest\Tests\Unit\Services\Billing;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\PlanChangeService;
use Everest\Repositories\Wings\DaemonServerRepository;
use Everest\Services\Servers\BuildModificationService;
use Everest\Services\Billing\ProductDeletionGuardService;
use Everest\Services\Billing\FreeProductEntitlementService;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

class PlanChangeSchedulingTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $path = tempnam(sys_get_temp_dir(), 'plan_change_scheduling_');
        if ($path === false) {
            throw new \RuntimeException('Failed to create temporary database.');
        }
        $this->dbPath = $path;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $path);
        config()->set('modules.billing.currency.code', 'USD');
        Carbon::setTestNow(Carbon::parse('2026-07-01T00:00:00Z'));
        Date::setTestNow(Carbon::parse('2026-07-01T00:00:00Z'));

        $settings = \Mockery::mock(SettingsRepositoryInterface::class);
        $settings->shouldReceive('get')->andReturnUsing(
            fn (string $key, mixed $default = null): mixed => $default
        );
        $this->app->instance(SettingsRepositoryInterface::class, $settings);

        $this->createSchema();
        DB::table('categories')->insert([
            'id' => 1,
            'uuid' => 'category-1',
            'allow_plan_changes' => true,
        ]);
        DB::table('nodes')->insert(['id' => 1, 'price_multiplier' => 1]);
        DB::table('users')->insert(['id' => 7]);
        DB::table('nests')->insert(['id' => 1]);
        DB::table('eggs')->insert(['id' => 1]);
        DB::table('allocations')->insert(['id' => 1]);
        DB::table('products')->insert([
            $this->product(1, 30),
            $this->product(2, 60),
            $this->product(3, 15),
        ]);
        foreach ([1, 2, 3] as $productId) {
            DB::table('billing_cycles')->insert([
                'product_id' => $productId,
                'days' => 30,
                'is_enabled' => true,
            ]);
        }
        DB::table('servers')->insert([
            'id' => 1,
            'uuid' => 'server-1',
            'name' => 'Test Server',
            'description' => '',
            'owner_id' => 7,
            'node_id' => 1,
            'allocation_id' => 1,
            'billing_product_id' => 1,
            'renewal_date' => now()->utc()->addDays(15)->toDateTimeString(),
            'billing_days' => 30,
            'billing_amount' => 30,
            'memory' => 100,
            'disk' => 100,
            'cpu' => 100,
            'swap' => 0,
            'io' => 500,
            'nest_id' => 1,
            'egg_id' => 1,
            'image' => 'example/image',
            'backup_limit' => 1,
            'database_limit' => 1,
            'allocation_limit' => 1,
            'subdomain_limit' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        Date::setTestNow();
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testQuoteUsesIntegerMinorUnitProrationAndPreservesCycle(): void
    {
        $quote = $this->service()->quote($this->server(), Product::query()->findOrFail(2));

        $this->assertSame('pay_now', $quote['mode']);
        $this->assertSame(3000, $quote['current_cycle_minor']);
        $this->assertSame(6000, $quote['target_cycle_minor']);
        $this->assertSame(1500, $quote['charge_minor']);
        $this->assertSame(30, $quote['billing_days']);
        $this->assertSame(15.0, $quote['charge_amount']);
        $this->assertSame(30, $this->server()->billing_days);
    }

    public function testProrationDoesNotCapPrepaidRemainingTimeToOneCycle(): void
    {
        DB::table('servers')->where('id', 1)->update([
            'renewal_date' => now()->utc()->addDays(45)->toDateTimeString(),
        ]);

        $quote = $this->service()->quote($this->server(), Product::query()->findOrFail(2));

        $this->assertSame(45 * 86400, $quote['remaining_seconds']);
        $this->assertSame(4500, $quote['charge_minor']);
    }

    public function testPaidUpgradeIsRejectedInsideTheCaptureSafetyWindow(): void
    {
        DB::table('servers')->where('id', 1)->update([
            'renewal_date' => now()->utc()->addMinutes(14)->toDateTimeString(),
        ]);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('too close to renewal');

        $this->service()->quote($this->server(), Product::query()->findOrFail(2));
    }

    public function testCurrentUsageViolationIsAWarningWhenSchedulingForRenewal(): void
    {
        DB::table('products')->where('id', 3)->update(['memory_limit' => 50]);
        $daemon = \Mockery::mock(DaemonServerRepository::class);
        $daemon->shouldReceive('setServer')->once()->andReturnSelf();
        $daemon->shouldReceive('getDetails')->once()->andReturn([
            'utilization' => ['memory_bytes' => 75 * 1024 * 1024],
        ]);

        $scheduled = $this->service(daemon: $daemon)
            ->scheduleChange($this->server(), Product::query()->findOrFail(3));

        $this->assertSame(3, $scheduled->scheduled_billing_product_id);
        $this->assertSame(75, $scheduled->scheduled_plan_change_snapshot['violations']['memory']['current']);
    }

    public function testCheaperPlanIsScheduledCancelledAndNeverAppliedEarly(): void
    {
        $service = $this->service();
        $target = Product::query()->findOrFail(3);
        $scheduled = $service->scheduleChange($this->server(), $target);

        $this->assertSame(1, $scheduled->billing_product_id);
        $this->assertSame(3, $scheduled->scheduled_billing_product_id);
        $this->assertNotNull($scheduled->scheduled_plan_change_snapshot);
        $this->assertNull($service->applyDueScheduledChange(1));

        $cancelled = $service->cancelScheduledChange($scheduled);
        $this->assertNull($cancelled->scheduled_billing_product_id);
        $this->assertNull($cancelled->scheduled_plan_change_at);
        $this->assertNull($cancelled->scheduled_plan_change_snapshot);
        $this->assertSame(1, $cancelled->billing_product_id);
    }

    public function testDueScheduledChangeAppliesOnceAndKeepsRenewalAndBillingDays(): void
    {
        $build = \Mockery::mock(BuildModificationService::class);
        $build->shouldReceive('handle')->once()->andReturnUsing(fn (Server $server): Server => $server);
        $entitlements = \Mockery::mock(FreeProductEntitlementService::class);
        $entitlements->shouldReceive('synchronizeLocked')->once()->withArgs(
            fn (Server $server, int $ownerId, int $productId): bool => $server->id === 1
                && $ownerId === 7
                && $productId === 3
        );
        $service = $this->service($build, $entitlements);
        $scheduled = $service->scheduleChange($this->server(), Product::query()->findOrFail(3));
        $originalRenewal = $scheduled->renewal_date->toIso8601String();

        Carbon::setTestNow($scheduled->renewal_date->copy()->addSecond());
        $applied = $service->applyDueScheduledChange(1);

        $this->assertNotNull($applied);
        $this->assertSame(3, $applied->billing_product_id);
        $this->assertSame(30, $applied->billing_days);
        $this->assertSame($originalRenewal, $applied->renewal_date->toIso8601String());
        $this->assertNull($applied->scheduled_billing_product_id);
        $this->assertNull($service->applyDueScheduledChange(1));
    }

    public function testCapturedUpgradeCanFulfillAfterRenewalBoundary(): void
    {
        $snapshot = $this->service()->quote($this->server(), Product::query()->findOrFail(2));
        $order = $this->capturedUpgradeOrder($snapshot);
        $renewal = $this->server()->renewal_date->copy()->addHour();
        Carbon::setTestNow($renewal);
        Date::setTestNow($renewal);

        $service = $this->capturedFulfillmentService(100);
        $target = Product::query()->findOrFail(2);
        $service->preflightPaidUpgrade($order, $target);
        $server = $service->fulfillPaidUpgrade($order, $target);

        $this->assertSame(2, $server->billing_product_id);
        $this->assertSame(100, $server->memory);
        $this->assertSame(60.0, $server->billing_amount);
        $this->assertNull($server->pending_plan_change_order_id);
        $this->assertSame('processed', DB::table('orders')->where('id', 1)->value('status'));
    }

    public function testCapturedUpgradeRecoveryUsesLockedSnapshotAfterCatalogAndTimeDrift(): void
    {
        $snapshot = $this->service()->quote($this->server(), Product::query()->findOrFail(2));
        $order = $this->capturedUpgradeOrder($snapshot);
        DB::table('products')->where('id', 2)->update([
            'price' => 90,
            'memory_limit' => 120,
        ]);
        $advanced = now()->addHour();
        Carbon::setTestNow($advanced);
        Date::setTestNow($advanced);

        $service = $this->capturedFulfillmentService(100);
        $target = Product::query()->findOrFail(2);
        $service->preflightPaidUpgrade($order, $target);
        $server = $service->fulfillPaidUpgrade($order, $target);

        $this->assertSame(100, $server->memory);
        $this->assertSame(60.0, $server->billing_amount);
        $this->assertSame('processed', DB::table('orders')->where('id', 1)->value('status'));
    }

    public function testCapturedUpgradeStillBlocksAnUnsafeLiveResourceReduction(): void
    {
        DB::table('products')->where('id', 2)->update(['memory_limit' => 50]);
        $daemon = \Mockery::mock(DaemonServerRepository::class);
        $daemon->shouldReceive('setServer')->twice()->andReturnSelf();
        $daemon->shouldReceive('getDetails')->twice()->andReturn(
            ['utilization' => ['memory_bytes' => 40 * 1024 * 1024]],
            ['utilization' => ['memory_bytes' => 75 * 1024 * 1024]],
        );
        $service = $this->service(daemon: $daemon);
        $snapshot = $service->quote($this->server(), Product::query()->findOrFail(2));
        $order = $this->capturedUpgradeOrder($snapshot);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('current usage exceeds');

        $service->preflightPaidUpgrade($order, Product::query()->findOrFail(2));
    }

    public function testProductDeletionGuardBlocksActiveServersAndUpgradeTargets(): void
    {
        $guard = new ProductDeletionGuardService();

        try {
            DB::transaction(fn () => $guard->assertDeletable([1]));
            $this->fail('Expected the active server product to be protected.');
        } catch (DisplayException $exception) {
            $this->assertStringContainsString('active server', $exception->getMessage());
        }

        $snapshot = $this->service()->quote($this->server(), Product::query()->findOrFail(2));
        $this->capturedUpgradeOrder($snapshot);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('plan-change payment');
        DB::transaction(fn () => $guard->assertDeletable([2]));
    }

    private function service(
        ?BuildModificationService $build = null,
        ?FreeProductEntitlementService $entitlements = null,
        ?DaemonServerRepository $daemon = null,
    ): PlanChangeService {
        if ($build === null) {
            $build = \Mockery::mock(BuildModificationService::class);
            $build->shouldNotReceive('handle');
        }
        if ($daemon === null) {
            $daemon = \Mockery::mock(DaemonServerRepository::class);
            $daemon->shouldNotReceive('setServer');
        }
        if ($entitlements === null) {
            $entitlements = \Mockery::mock(FreeProductEntitlementService::class);
            $entitlements->shouldNotReceive('synchronizeLocked');
        }

        return new PlanChangeService($build, $daemon, $entitlements);
    }

    private function server(): Server
    {
        return Server::query()->without('allocation')->findOrFail(1);
    }

    /**
     * @param array<string, mixed> $snapshot
     */
    private function capturedUpgradeOrder(array $snapshot): \Everest\Models\Billing\Order
    {
        DB::table('orders')->insert([
            'id' => 1,
            'name' => 'Captured upgrade',
            'user_id' => 7,
            'description' => 'Captured plan upgrade',
            'total' => $snapshot['charge_amount'],
            'status' => 'fulfilling',
            'product_id' => 2,
            'source_product_id' => 1,
            'product_name' => 'Product 2',
            'billing_days' => 30,
            'server_id' => 1,
            'type' => 'upg',
            'payment_processor' => 'stripe',
            'checkout_currency' => 'USD',
            'checkout_amount_minor' => $snapshot['charge_minor'],
            'plan_change_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
            'fulfillment_claim' => 'claim-1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('payment_transactions')->insert([
            'id' => 1,
            'order_id' => 1,
            'processor' => 'stripe',
            'capture_id' => 'charge-1',
            'status' => 'captured',
            'amount' => $snapshot['charge_amount'],
            'currency' => 'USD',
            'captured_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('servers')->where('id', 1)->update(['pending_plan_change_order_id' => 1]);

        return \Everest\Models\Billing\Order::query()->findOrFail(1);
    }

    private function capturedFulfillmentService(int $expectedMemory): PlanChangeService
    {
        $build = \Mockery::mock(BuildModificationService::class);
        $build->shouldReceive('handle')
            ->once()
            ->withArgs(
                fn (Server $server, array $data): bool => $server->id === 1
                    && $data['memory'] === $expectedMemory
            )
            ->andReturnUsing(fn (Server $server): Server => $server);
        $entitlements = \Mockery::mock(FreeProductEntitlementService::class);
        $entitlements->shouldReceive('synchronizeLocked')->once()->withArgs(
            fn (Server $server, int $ownerId, int $productId): bool => $server->id === 1
                && $ownerId === 7
                && $productId === 2
        );

        return $this->service($build, $entitlements);
    }

    /**
     * @return array<string, mixed>
     */
    private function product(int $id, int $price): array
    {
        return [
            'id' => $id,
            'uuid' => "product-{$id}",
            'category_uuid' => 'category-1',
            'name' => "Product {$id}",
            'price' => $price,
            'visible' => true,
            'cpu_limit' => 100,
            'memory_limit' => 100,
            'disk_limit' => 100,
            'backup_limit' => 1,
            'database_limit' => 1,
            'allocation_limit' => 1,
            'subdomain_limit' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    private function createSchema(): void
    {
        Schema::create('categories', function (Blueprint $table): void {
            $table->id();
            $table->string('uuid');
            $table->boolean('allow_plan_changes');
        });
        Schema::create('users', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('nests', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('eggs', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('nodes', function (Blueprint $table): void {
            $table->increments('id');
            $table->decimal('price_multiplier', 5, 2)->default(1);
        });
        Schema::create('allocations', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('server_id')->nullable();
        });
        Schema::create('databases', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('server_id');
        });
        Schema::create('backups', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('server_id');
            $table->softDeletes();
        });
        Schema::create('server_custom_domains', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('server_id');
        });
        Schema::create('products', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('uuid');
            $table->string('category_uuid');
            $table->string('name');
            $table->decimal('price', 10, 2);
            $table->boolean('visible');
            $table->unsignedInteger('cpu_limit');
            $table->unsignedInteger('memory_limit');
            $table->unsignedInteger('disk_limit');
            $table->unsignedInteger('backup_limit');
            $table->unsignedInteger('database_limit');
            $table->unsignedInteger('allocation_limit');
            $table->unsignedInteger('subdomain_limit')->nullable();
            $table->timestamps();
        });
        Schema::create('billing_cycles', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('product_id');
            $table->integer('days');
            $table->boolean('is_enabled');
        });
        Schema::create('orders', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('name');
            $table->unsignedInteger('user_id');
            $table->string('description');
            $table->decimal('total', 10, 2);
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('source_product_id')->nullable();
            $table->string('product_name')->nullable();
            $table->integer('billing_days')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->string('type')->nullable();
            $table->string('status');
            $table->string('payment_processor')->nullable();
            $table->char('checkout_currency', 3)->nullable();
            $table->unsignedBigInteger('checkout_amount_minor')->nullable();
            $table->json('plan_change_snapshot')->nullable();
            $table->string('fulfillment_claim')->nullable();
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('capture_id')->nullable();
            $table->string('status')->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->nullable();
            $table->string('provider_negative_status')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();
        });
        Schema::create('servers', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('uuid');
            $table->string('name');
            $table->text('description');
            $table->unsignedInteger('owner_id');
            $table->unsignedInteger('node_id');
            $table->unsignedInteger('allocation_id');
            $table->unsignedInteger('billing_product_id')->nullable();
            $table->unsignedBigInteger('pending_plan_change_order_id')->nullable();
            $table->unsignedInteger('scheduled_billing_product_id')->nullable();
            $table->timestamp('scheduled_plan_change_at')->nullable();
            $table->json('scheduled_plan_change_snapshot')->nullable();
            $table->timestamp('scheduled_plan_change_retry_at')->nullable();
            $table->text('scheduled_plan_change_last_error')->nullable();
            $table->dateTime('renewal_date')->nullable();
            $table->timestamp('last_plan_change_at')->nullable();
            $table->integer('billing_days')->nullable();
            $table->decimal('billing_amount', 10, 2)->nullable();
            $table->unsignedInteger('memory');
            $table->unsignedInteger('disk');
            $table->unsignedInteger('cpu');
            $table->integer('swap');
            $table->unsignedInteger('io');
            $table->unsignedInteger('nest_id');
            $table->unsignedInteger('egg_id');
            $table->string('image');
            $table->unsignedInteger('backup_limit');
            $table->unsignedInteger('database_limit');
            $table->unsignedInteger('allocation_limit');
            $table->unsignedInteger('subdomain_limit')->nullable();
            $table->timestamps();
        });
    }
}
