<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\Server;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\FreeProductEntitlementService;

class FreeProductEntitlementServiceTest extends TestCase
{
    private string $dbPath;

    private FreeProductEntitlementService $service;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'free_entitlement_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('products', function (Blueprint $table): void {
            $table->id();
            $table->string('uuid');
            $table->string('category_uuid');
            $table->string('name');
            $table->string('icon')->nullable();
            $table->double('price');
            $table->string('description')->nullable();
            $table->boolean('visible')->nullable();
            $table->unsignedInteger('cpu_limit')->default(0);
            $table->integer('memory_limit')->default(0);
            $table->integer('disk_limit')->default(0);
            $table->unsignedInteger('backup_limit')->default(0);
            $table->unsignedInteger('database_limit')->default(0);
            $table->unsignedInteger('allocation_limit')->default(0);
            $table->unsignedInteger('subdomain_limit')->nullable();
            $table->timestamps();
        });
        Schema::create('servers', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('owner_id');
            $table->unsignedBigInteger('billing_product_id')->nullable();
            $table->unsignedInteger('allocation_id')->nullable();
            $table->timestamps();
        });
        Schema::create('free_product_entitlements', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('order_id')->nullable()->unique();
            $table->unsignedInteger('server_id')->nullable()->unique();
            $table->string('status')->default('reserved');
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'product_id']);
        });

        DB::table('products')->insert([
            $this->product(1, 10.0),
            $this->product(2, 0.0),
            $this->product(3, 0.0),
        ]);
        DB::table('servers')->insert([
            'id' => 1,
            'owner_id' => 10,
            'billing_product_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->service = new FreeProductEntitlementService();
    }

    public function tearDown(): void
    {
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testPaidToFreeClaimsAndFreeToPaidReleasesTheGuard(): void
    {
        $server = $this->server(1);

        DB::transaction(function () use ($server): void {
            $this->service->synchronizeLocked($server, 10, 2);
            DB::table('servers')->where('id', 1)->update(['billing_product_id' => 2]);
        });

        $this->assertDatabaseHas('free_product_entitlements', [
            'user_id' => 10,
            'product_id' => 2,
            'server_id' => 1,
            'status' => 'consumed',
        ]);

        $server = $this->server(1);
        DB::transaction(function () use ($server): void {
            $this->service->synchronizeLocked($server, 10, 1);
            DB::table('servers')->where('id', 1)->update(['billing_product_id' => 1]);
        });

        $this->assertDatabaseMissing('free_product_entitlements', ['server_id' => 1]);
    }

    public function testChangingBetweenFreeProductsMovesTheGuard(): void
    {
        DB::table('servers')->where('id', 1)->update(['billing_product_id' => 2]);
        DB::table('free_product_entitlements')->insert([
            'user_id' => 10,
            'product_id' => 2,
            'server_id' => 1,
            'status' => 'consumed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $server = $this->server(1);

        DB::transaction(function () use ($server): void {
            $this->service->synchronizeLocked($server, 10, 3);
            DB::table('servers')->where('id', 1)->update(['billing_product_id' => 3]);
        });

        $this->assertDatabaseMissing('free_product_entitlements', [
            'user_id' => 10,
            'product_id' => 2,
        ]);
        $this->assertDatabaseHas('free_product_entitlements', [
            'user_id' => 10,
            'product_id' => 3,
            'server_id' => 1,
            'status' => 'consumed',
        ]);
    }

    public function testOwnerTransferCannotStealAReservedFreeCheckout(): void
    {
        DB::table('servers')->where('id', 1)->update(['billing_product_id' => 2]);
        DB::table('free_product_entitlements')->insert([
            [
                'user_id' => 10,
                'product_id' => 2,
                'server_id' => 1,
                'status' => 'consumed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 20,
                'product_id' => 2,
                'server_id' => null,
                'status' => 'reserved',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
        $server = $this->server(1);

        try {
            DB::transaction(function () use ($server): void {
                $this->service->synchronizeLocked($server, 20, 2);
                DB::table('servers')->where('id', 1)->update(['owner_id' => 20]);
            });
            $this->fail('Expected the reserved entitlement to block the owner transfer.');
        } catch (DisplayException $exception) {
            $this->assertStringContainsString('pending checkout', $exception->getMessage());
        }

        $this->assertDatabaseHas('free_product_entitlements', [
            'user_id' => 10,
            'product_id' => 2,
            'server_id' => 1,
        ]);
        $this->assertDatabaseHas('free_product_entitlements', [
            'user_id' => 20,
            'product_id' => 2,
            'server_id' => null,
            'status' => 'reserved',
        ]);
        $this->assertDatabaseHas('servers', ['id' => 1, 'owner_id' => 10]);
    }

    public function testSynchronizationRefusesToRunOutsideTheOwningTransaction(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('inside a database transaction');

        $this->service->synchronizeLocked($this->server(1), 10, 2);
    }

    private function server(int $id): Server
    {
        /** @var Server $server */
        $server = Server::query()->without('allocation')->findOrFail($id);

        return $server;
    }

    private function product(int $id, float $price): array
    {
        return [
            'id' => $id,
            'uuid' => "product-{$id}",
            'category_uuid' => 'category-1',
            'name' => "Product {$id}",
            'price' => $price,
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }
}
