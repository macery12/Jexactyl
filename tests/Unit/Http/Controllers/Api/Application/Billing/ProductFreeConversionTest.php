<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application\Billing;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Http\Controllers\Api\Application\Billing\ProductController;

class ProductFreeConversionTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'product_free_conversion_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('servers', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedBigInteger('billing_product_id')->nullable();
        });
        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('product_id');
            $table->string('type');
            $table->string('status');
        });
    }

    public function tearDown(): void
    {
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testReferencedPaidProductCannotBeConvertedToFree(): void
    {
        DB::table('servers')->insert(['id' => 1, 'billing_product_id' => 42]);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('servers or active new-server orders');

        $this->assertPriceChange($this->paidProduct(42), ['price' => 0.0]);
    }

    public function testActiveNewServerOrderBlocksPaidProductConversionToFree(): void
    {
        DB::table('orders')->insert([
            'id' => 1,
            'product_id' => 42,
            'type' => 'new',
            'status' => 'pending',
        ]);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('active new-server orders');

        $this->assertPriceChange($this->paidProduct(42), ['price' => 0.0]);
    }

    public function testUnreferencedPaidProductCanBeConvertedToFree(): void
    {
        $this->assertPriceChange($this->paidProduct(42), ['price' => 0.0]);

        $this->addToAssertionCount(1);
    }

    private function assertPriceChange(Product $product, array $attributes): void
    {
        $controller = $this->app->make(ProductController::class);
        $method = new \ReflectionMethod($controller, 'assertCanApplyPriceChange');
        $method->setAccessible(true);
        $method->invoke($controller, $product, $attributes);
    }

    private function paidProduct(int $id): Product
    {
        $product = new Product();
        $product->forceFill(['id' => $id, 'price' => 10.0]);
        $product->exists = true;

        return $product;
    }
}
