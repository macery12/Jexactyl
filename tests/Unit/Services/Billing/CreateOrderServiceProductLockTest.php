<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Services\Billing\CreateOrderService;

class CreateOrderServiceProductLockTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'create_order_product_lock_');
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
            $table->timestamps();
        });
    }

    protected function tearDown(): void
    {
        @unlink($this->dbPath);

        parent::tearDown();
    }

    #[DataProvider('classificationChanges')]
    public function testCheckoutRejectsAConcurrentFreePaidClassificationChange(
        float $initialPrice,
        float $lockedPrice,
    ): void {
        DB::table('products')->insert([
            'id' => 1,
            'uuid' => 'product-1',
            'category_uuid' => 'category-1',
            'name' => 'Product 1',
            'price' => $initialPrice,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        /** @var Product $staleProduct */
        $staleProduct = Product::query()->findOrFail(1);
        DB::table('products')->where('id', 1)->update(['price' => $lockedPrice]);

        $user = new User();
        $user->id = 7;
        $user->email = 'customer@example.test';

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('changed between free and paid');

        (new CreateOrderService())->create(
            null,
            $user,
            $staleProduct,
            Order::STATUS_PENDING,
            Order::TYPE_NEW,
            additionalData: ['payment_processor' => 'stripe'],
            preCalculatedTotal: 10.0,
            preCalculatedSubtotal: 10.0,
            preCalculatedDiscount: 0.0,
        );
    }

    public static function classificationChanges(): array
    {
        return [
            'paid to free' => [10.0, 0.0],
            'free to paid' => [0.0, 10.0],
        ];
    }
}
