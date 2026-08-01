<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\PayPalOrderCreationService;

class PayPalOrderCreationServiceTest extends TestCase
{
    private string $dbPath;

    public function setUp(): void
    {
        parent::setUp();

        $dbPath = tempnam(sys_get_temp_dir(), 'paypal_order_ledger_test_');
        if ($dbPath === false) {
            throw new \RuntimeException('Failed to create temporary sqlite database.');
        }
        $this->dbPath = $dbPath;
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('product_id');
            $table->string('product_name');
            $table->string('status');
            $table->string('checkout_request_fingerprint');
            $table->string('checkout_fingerprint');
            $table->string('checkout_currency', 3);
            $table->unsignedBigInteger('checkout_amount_minor');
            $table->decimal('total', 10, 2);
            $table->timestamps();
        });
        Schema::create('payment_transactions', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->string('processor');
            $table->string('external_id')->nullable();
            $table->json('raw_metadata')->nullable();
            $table->timestamps();
        });
    }

    public function tearDown(): void
    {
        \Mockery::close();
        @unlink($this->dbPath);

        parent::tearDown();
    }

    public function testRetryReusesThePersistedBodyAfterUrlsAndBrandChange(): void
    {
        $now = now();
        DB::table('orders')->insert([
            'id' => 31,
            'user_id' => 9,
            'product_id' => 4,
            'product_name' => 'Immutable Product',
            'status' => Order::STATUS_PENDING,
            'checkout_request_fingerprint' => str_repeat('a', 64),
            'checkout_fingerprint' => str_repeat('b', 64),
            'checkout_currency' => 'USD',
            'checkout_amount_minor' => 1999,
            'total' => 19.99,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('payment_transactions')->insert([
            'id' => 41,
            'order_id' => 31,
            'processor' => 'paypal',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $integrity = \Mockery::mock(CheckoutIntegrityService::class);
        $integrity->shouldReceive('paypalReference')->andReturn('order_31');
        $integrity->shouldReceive('currency')->andReturn('USD');
        $integrity->shouldReceive('formattedAmount')->andReturn('19.99');
        $integrity->shouldReceive('paypalCustomData')->andReturn([
            'order_id' => 31,
            'product_id' => 4,
            'checkout_fingerprint' => str_repeat('b', 64),
        ]);

        $service = new PayPalOrderCreationService($integrity);
        $order = Order::query()->findOrFail(31);

        config()->set('app.name', 'Original Brand');
        $first = $service->payload(
            $order,
            'https://panel.example/return-a',
            'https://panel.example/cancel-a',
        );

        config()->set('app.name', 'Changed Brand');
        $second = $service->payload(
            $order,
            'https://panel.example/return-b',
            'https://panel.example/cancel-b',
        );

        $this->assertSame($first, $second);
        $this->assertSame('Original Brand', $second['application_context']['brand_name']);
        $this->assertSame(
            'https://panel.example/return-a',
            $second['application_context']['return_url']
        );
        $this->assertSame(
            'https://panel.example/cancel-a',
            $second['application_context']['cancel_url']
        );
    }
}
