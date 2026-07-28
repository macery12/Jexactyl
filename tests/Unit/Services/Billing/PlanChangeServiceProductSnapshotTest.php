<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\Server;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\PlanChangeService;
use Everest\Repositories\Wings\DaemonServerRepository;
use Everest\Services\Servers\BuildModificationService;
use Everest\Services\Billing\FreeProductEntitlementService;

class PlanChangeServiceProductSnapshotTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'plan_change_product_snapshot_');
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
            $table->double('price');
            $table->unsignedInteger('cpu_limit');
            $table->integer('memory_limit');
            $table->integer('disk_limit');
            $table->unsignedInteger('backup_limit');
            $table->unsignedInteger('database_limit');
            $table->unsignedInteger('allocation_limit');
            $table->unsignedInteger('subdomain_limit')->nullable();
            $table->timestamps();
        });
        Schema::create('allocations', function (Blueprint $table): void {
            $table->increments('id');
        });
        Schema::create('servers', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('owner_id');
            $table->unsignedInteger('allocation_id');
            $table->unsignedInteger('billing_product_id')->nullable();
            $table->dateTime('renewal_date')->nullable();
            $table->timestamp('last_plan_change_at')->nullable();
            $table->unsignedInteger('memory');
            $table->unsignedInteger('disk');
            $table->unsignedInteger('cpu');
            $table->unsignedInteger('backup_limit');
            $table->unsignedInteger('database_limit');
            $table->unsignedInteger('allocation_limit');
            $table->unsignedInteger('subdomain_limit')->nullable();
            $table->integer('billing_days')->nullable();
            $table->timestamps();
        });

        DB::table('products')->insert([
            $this->product(1, 75),
            $this->product(2, 100),
        ]);
        DB::table('allocations')->insert(['id' => 1]);
        DB::table('servers')->insert([
            'id' => 1,
            'owner_id' => 7,
            'allocation_id' => 1,
            'billing_product_id' => 1,
            'renewal_date' => now()->addMonth(),
            'memory' => 75,
            'disk' => 75,
            'cpu' => 75,
            'backup_limit' => 75,
            'database_limit' => 75,
            'allocation_limit' => 75,
            'subdomain_limit' => 75,
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

    public function testLockedProductMustMatchTheLimitsThatWerePrevalidated(): void
    {
        /** @var Product $staleTarget */
        $staleTarget = Product::query()->findOrFail(2);
        DB::table('products')->where('id', 2)->update(['disk_limit' => 50]);
        /** @var Server $server */
        $server = Server::query()->without('allocation')->findOrFail(1);

        $build = \Mockery::mock(BuildModificationService::class);
        $build->shouldNotReceive('handle');
        $daemon = \Mockery::mock(DaemonServerRepository::class);
        $daemon->shouldNotReceive('setServer');
        $entitlements = \Mockery::mock(FreeProductEntitlementService::class);
        $entitlements->shouldNotReceive('synchronizeLocked');

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('resource limits were being validated');

        (new PlanChangeService($build, $daemon, $entitlements))
            ->changePlan($server, $staleTarget);
    }

    private function product(int $id, int $limit): array
    {
        return [
            'id' => $id,
            'uuid' => "product-{$id}",
            'category_uuid' => 'category-1',
            'name' => "Product {$id}",
            'price' => 10,
            'cpu_limit' => $limit,
            'memory_limit' => $limit,
            'disk_limit' => $limit,
            'backup_limit' => $limit,
            'database_limit' => $limit,
            'allocation_limit' => $limit,
            'subdomain_limit' => $limit,
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }
}
